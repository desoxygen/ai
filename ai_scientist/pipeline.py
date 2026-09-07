"""Guarded pipeline runner for AI-Scientist.

Implements the research loop stage by stage (ideas → novelty → experiments →
writeup → review), adding:
  * StageGuard on every stage (failures, repeated outputs, interactive
    continue/skip/abort decisions),
  * per-idea status tracking,
  * Obsidian notes: idea notes, status updates, run overview, journal.

RunAborted escapes as-is; StageSkip is converted into a graceful "skipped"
status for the current idea/stage.
"""
import datetime
import json
import os
import os.path as osp
import shutil

from ai_scientist import loop_guard, obsidian_notes
from ai_scientist.loop_guard import StageGuard, RunAborted, StageSkip
from ai_scientist.generate_ideas import generate_ideas, check_idea_novelty
from ai_scientist.llm import create_client
from ai_scientist.perform_experiments import perform_experiments
from ai_scientist.perform_writeup import perform_writeup
from ai_scientist.perform_review import perform_review, load_paper
from ai_scientist.research_quality import (
    append_learning, idea_budget_deadline, write_run_meta,
)

# Mirror guard decisions into the Obsidian journal.
def _journal_observer(event: dict):
    if event.get("type") in ("guard_decision", "repeat_detected") and event.get("stage") != "llm-call":
        try:
            obsidian_notes.append_journal(
                f"⚠️ Guard [{event.get('stage')}]: {event.get('reason', '')} → {event.get('action', '')}")
        except Exception:
            pass

loop_guard.add_observer(_journal_observer)


def check_latex_dependencies() -> bool:
    missing = [d for d in ("pdflatex", "chktex") if shutil.which(d) is None]
    if missing:
        print(f"Отсутствуют LaTeX-зависимости: {missing}")
        return False
    return True


class PipelineRunner:
    def __init__(self, template: str, model: str, num_ideas: int = 5,
                 num_reflections: int = 3, engine: str = "semanticscholar",
                 improvement: bool = False, stages=None, run_id: str = "",
                 emit=None, stop_event=None, idea_filter: str = ""):
        self.template = template
        self.base_dir = osp.join("templates", template)
        self.results_dir = osp.join("results", template)
        self.model = model
        self.num_ideas = num_ideas
        self.num_reflections = num_reflections
        self.engine = engine
        self.improvement = improvement
        self.stages = stages or {"ideas", "novelty", "experiments", "writeup", "review"}
        self.run_id = run_id or datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        self.statuses = {}   # idea Name -> {"status": ..., "note": ...}
        self.journal_lines = []
        self.client = None
        self.client_model = None
        # Контракт событий (EVENTS.md): emit(stage, status, message, **kw).
        # None по умолчанию — поведение идентично прежнему.
        self.emit = emit
        self.stop_event = stop_event
        self.idea_filter = idea_filter
        self._last_review_score = {}  # idea Name -> review "Overall" score

    # ------------------------------------------------------------------ util
    def log(self, msg: str):
        line = f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {msg}"
        print(line)
        self.journal_lines.append(line)

    def _emit(self, stage, status, message, idea_id="", detail=None):
        if self.emit is None:
            return
        try:
            self.emit(stage, status, message, idea_id=idea_id, detail=detail)
        except Exception:
            pass

    def _check_stop(self):
        if self.stop_event is not None and self.stop_event.is_set():
            raise RunAborted("stopped by user")

    def set_status(self, idea, status, note=""):
        self.statuses[idea["Name"]] = {"status": status, "note": note}
        checklist = {"Эксперименты": None, "Статья": None, "Рецензия": None}
        if status in ("done", "reviewed"):
            checklist = {"Эксперименты": True, "Статья": True, "Рецензия": True}
        elif status == "experiments_failed":
            checklist = {"Эксперименты": False, "Статья": "skip", "Рецензия": "skip"}
        elif status == "writeup_failed":
            checklist = {"Эксперименты": True, "Статья": False, "Рецензия": "skip"}
        elif status == "skipped":
            checklist = {"Эксперименты": "skip", "Статья": "skip", "Рецензия": "skip"}
        obsidian_notes.update_idea_status(self.template, idea["Name"], status,
                                          checklist=checklist,
                                          error=note if status.endswith("failed") else "")

    # ------------------------------------------------------------------ run
    def run(self) -> dict:
        summary = {"run_id": self.run_id, "template": self.template, "model": self.model,
                   "ideas": [], "aborted": False}
        obsidian_notes.append_journal(
            f"🚀 Старт прогона «{self.template}» ({self.run_id}), модель {self.model}, "
            f"этапы: {', '.join(sorted(self.stages))}")
        try:
            if "experiments" in self.stages or "writeup" in self.stages:
                if not check_latex_dependencies():
                    print("LaTeX не найден — стадии writeup/review будут недоступны.")
                    self.stages.discard("writeup")
                    self.stages.discard("review")
            self.client, self.client_model = create_client(self.model)

            ideas = self.stage_ideas()
            if "novelty" in self.stages and ideas:
                ideas = self.stage_novelty(ideas)
                # Новизна проверялась: оставляем только подтверждённо новые
                # (даже если это ноль — не гоняем эксперименты на "не novel").
                novel = [i for i in ideas if i.get("novel", False)]
                if novel:
                    ideas = novel
                else:
                    self.log("Ни одна идея не признана новой — этапы выполнения пропущены.")
                    self.write_overview()
                    summary["ideas"] = []
                    summary["statuses"] = self.statuses
                    return summary
            if self.idea_filter:
                ideas = [i for i in ideas if i.get("Name") == self.idea_filter]
                if not ideas:
                    self.log(f"Идея «{self.idea_filter}» не найдена в ideas.json.")
                    summary["ideas"] = []
                    summary["statuses"] = self.statuses
                    return summary

            summary["ideas"] = [i.get("Name") for i in ideas]
            obsidian_notes.sync_ideas_from_json(self.base_dir, self.template, self.run_id)

            for idea in ideas:
                self._check_stop()
                try:
                    self.run_idea(idea)
                except RunAborted:
                    raise
                except Exception as e:
                    self.log(f"Идея {idea.get('Name')}: непредвиденная ошибка: {e}")
                    self.set_status(idea, "failed", str(e)[:200])
        except RunAborted as e:
            summary["aborted"] = True
            self.log(f"Прогон прерван: {e}")
        except KeyboardInterrupt:
            summary["aborted"] = True
            self.log("Прогон прерван пользователем (Ctrl+C) — статус сохранён.")
        finally:
            self.write_overview()
        summary["statuses"] = self.statuses
        return summary

    # ------------------------------------------------------------------ stages
    def stage_ideas(self):
        # Стадия "ideas" явно выбрана → генерируем новые; иначе переиспользуем.
        if "ideas" not in self.stages:
            existing = self._ideas_from_json()
            if existing:
                self.log(f"Стадия генерации выключена — загружены существующие идеи ({len(existing)}).")
                return existing
            self.log("ideas.json пуст, а генерация выключена — идей нет.")
            return []
        guard = StageGuard("ideas")
        guard.info(f"generate {self.num_ideas} ideas for {self.template}")
        self._emit("ideas", "started", f"generate {self.num_ideas} ideas for {self.template}")
        try:
            ideas = generate_ideas(
                self.base_dir, client=self.client, model=self.client_model,
                skip_generation=False, max_num_generations=self.num_ideas,
                num_reflections=self.num_reflections,
            )
        except StageSkip:
            self._emit("ideas", "log", "генерация остановлена guard'ом — беру существующие идеи")
            self.log("Генерация идей остановлена guard'ом — работаем с уже сгенерированными.")
            return self._ideas_from_json()
        except RunAborted:
            self._emit("ideas", "fail", "генерация прервана")
            raise
        except Exception as e:
            self._emit("ideas", "fail", str(e), detail={"error": str(e)})
            raise
        self._emit("ideas", "done", f"{len(ideas)} идей")
        guard.success()
        return ideas

    def stage_novelty(self, ideas):
        guard = StageGuard("novelty")
        guard.info(f"novelty check for {len(ideas)} ideas")
        self._emit("novelty", "started", f"novelty check for {len(ideas)} ideas")
        try:
            ideas = check_idea_novelty(ideas, base_dir=self.base_dir, client=self.client,
                                       model=self.client_model, engine=self.engine)
            guard.success()
        except StageSkip:
            self._emit("novelty", "log", "проверка новизны прервана guard'ом")
            self.log("Проверка новизны прервана guard'ом — используем идеи как есть (novel=True).")
            for i in ideas:
                i.setdefault("novel", True)
        except RunAborted:
            self._emit("novelty", "fail", "проверка новизны прервана")
            raise
        self._emit("novelty", "done", f"{len(ideas)} идей проверено")
        return ideas

    # ------------------------------------------------------------------ per idea
    def run_idea(self, idea):
        name = idea["Name"]
        self._check_stop()
        if not ({"experiments", "writeup", "review"} & self.stages):
            self.log(f"Идея «{name}»: стадии выполнения выключены — идея только зафиксирована.")
            self.set_status(idea, "noted")
            return

        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        folder_name = osp.join(self.results_dir, f"{timestamp}_{name}")
        self.log(f"▶ Идея «{name}» → {folder_name}")

        shutil.copytree(self.base_dir, folder_name, dirs_exist_ok=True)
        # Reproducibility snapshot: model, seeds, package versions, code hash.
        write_run_meta(
            folder_name, model=self.model, run_id=self.run_id, idea_name=name,
            seeds=self._num_seeds(),
        )
        # Wall-clock budget for this idea (AISC_IDEA_BUDGET_MINUTES, 0=off).
        deadline = idea_budget_deadline()
        if deadline:
            self.log(f"Бюджет на идею: {os.environ.get('AISC_IDEA_BUDGET_MINUTES')} мин.")
        baseline = None
        if "experiments" in self.stages:
            try:
                with open(osp.join(self.base_dir, "run_0", "final_info.json")) as f:
                    baseline = json.load(f)
                if isinstance(baseline, dict):
                    baseline = {k: v["means"] for k, v in baseline.items()}
            except Exception as e:
                self.log(f"Нет baseline (run_0/final_info.json): {e}. Эксперименты невозможны.")
                self.set_status(idea, "skipped", "no baseline results")
                return

        notes = osp.join(folder_name, "notes.txt")
        with open(notes, "w") as f:
            f.write(f"# Title: {idea['Title']}\n")
            f.write(f"# Experiment description: {idea['Experiment']}\n")
            f.write("## Run 0: Baseline\n")
            f.write(f"Results: {baseline}\n")
            f.write("Description: Baseline results.\n")

        if "experiments" in self.stages:
            ok = self.stage_experiments(idea, folder_name, baseline, notes, deadline=deadline)
            if not ok:
                return

        if "writeup" in self.stages:
            self._check_stop()
            ok = self.stage_writeup(idea, folder_name, notes)
            if not ok:
                return
        elif osp.exists(osp.join(folder_name, "latex", "template.tex")):
            self.log("Writeup выключен — пропускаю, но использую существующий template.tex.")

        if "review" in self.stages:
            self._check_stop()
            self.stage_review(idea, folder_name)

        self.set_status(idea, "done" if "review" not in self.stages else "reviewed")
        # Knowledge base: record the outcome so idea generation learns from it.
        detail = (self.statuses.get(name, {}).get("note", "") or "").strip()
        try:
            review_score = self._last_review_score.get(name)
        except AttributeError:
            review_score = None
        if review_score is not None:
            detail = (detail + f" · review {review_score}/10").strip(" ·")
        append_learning(self.template, name,
                        self.statuses.get(name, {}).get("status", "done"), detail)
        self.log(f"✔ Идея «{name}» завершена.")

    def _num_seeds(self) -> int:
        try:
            return max(1, int(os.environ.get("AISC_EXP_SEEDS", "1")))
        except ValueError:
            return 1

    def _make_coder(self, folder_name, idea, fnames):
        from aider.coders import Coder
        from aider.io import InputOutput
        from aider.models import Model
        io = InputOutput(yes=True, chat_history_file=osp.join(
            folder_name, f"{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}_aider.txt"))
        if self.model.startswith("openrouter/"):
            # aider speaks OpenRouter natively via the "openrouter/" prefix
            main_model = Model(self.model)
        elif self.model.startswith("ollama/"):
            # local model via litellm's ollama_chat provider
            os.environ.setdefault("OLLAMA_API_BASE", "http://localhost:11434")
            main_model = Model("ollama_chat/" + self.model.split("/", 1)[1])
        elif self.model == "deepseek-coder-v2-0724":
            main_model = Model("deepseek/deepseek-coder")
        elif self.model == "deepseek-reasoner":
            main_model = Model("deepseek/deepseek-reasoner")
        elif self.model == "llama3.1-405b":
            main_model = Model("openrouter/meta-llama/llama-3.1-405b-instruct")
        else:
            main_model = Model(self.model)
        return Coder.create(main_model=main_model, fnames=fnames, io=io,
                            stream=False, use_git=False, edit_format="diff")

    def stage_experiments(self, idea, folder_name, baseline, notes, deadline=0.0) -> bool:
        guard = StageGuard(f"experiments:{idea['Name']}")
        exp_file = osp.join(folder_name, "experiment.py")
        vis_file = osp.join(folder_name, "plot.py")
        self._emit("experiments", "started", f"эксперименты для «{idea['Name']}»",
                   idea_id=idea["Name"])
        try:
            coder = self._make_coder(folder_name, idea, [exp_file, vis_file, notes])
            self.log(f"*Эксперименты* для «{idea['Name']}»")
            ok = perform_experiments(idea, folder_name, coder, baseline, deadline=deadline)
            if not ok:
                guard.failure("perform_experiments вернул False (достигнут лимит итераций)")
                self.set_status(idea, "experiments_failed", "iteration limit")
                self._emit("experiments", "fail", "эксперименты провалились (лимит итераций)",
                           idea_id=idea["Name"], detail={"error": "iteration limit"})
                return False
            guard.success()
            # Surface the sanity verdict of the final run in status/journal.
            sanity_path = osp.join(folder_name, "sanity.json")
            if osp.exists(sanity_path):
                try:
                    with open(sanity_path, encoding="utf-8") as f:
                        verdict = json.load(f)
                    v = verdict.get("verdict", "unknown")
                    self.log(f"Sanity «{idea['Name']}»: {v} — {verdict.get('reason', '')}")
                    if v == "suspect":
                        self._emit("experiments", "log",
                                   f"sanity: ПОДОЗРИТЕЛЬНЫЙ результат — {verdict.get('reason', '')}",
                                   idea_id=idea["Name"])
                except Exception:
                    pass
            obsidian_notes.update_idea_status(self.template, idea["Name"], "experiments",
                                              checklist={"Эксперименты": True})
            obsidian_notes.append_experiment_results(self.template, idea["Name"], folder_name)
            self._emit("experiments", "done", "эксперименты завершены",
                       idea_id=idea["Name"], detail={"path": folder_name})
            return True
        except StageSkip:
            self.set_status(idea, "skipped", "experiments skipped by guard")
            self._emit("experiments", "fail", "эксперименты пропущены guard'ом",
                       idea_id=idea["Name"])
            return False
        except RunAborted:
            self._emit("experiments", "fail", "эксперименты прерваны", idea_id=idea["Name"])
            raise
        except Exception as e:
            guard.failure(str(e))
            self.set_status(idea, "experiments_failed", str(e)[:200])
            self._emit("experiments", "fail", str(e), idea_id=idea["Name"],
                       detail={"error": str(e)[:300]})
            return False

    def stage_writeup(self, idea, folder_name, notes) -> bool:
        guard = StageGuard(f"writeup:{idea['Name']}")
        exp_file = osp.join(folder_name, "experiment.py")
        writeup_file = osp.join(folder_name, "latex", "template.tex")
        self._emit("writeup", "started", f"написание статьи для «{idea['Name']}»",
                   idea_id=idea["Name"])
        try:
            coder = self._make_coder(folder_name, idea, [exp_file, writeup_file, notes])
            self.log(f"*Написание статьи* для «{idea['Name']}»")
            perform_writeup(idea, folder_name, coder, self.client, self.client_model,
                            engine=self.engine)
            guard.success()
            obsidian_notes.update_idea_status(self.template, idea["Name"], "writeup",
                                              checklist={"Статья": True})
            self._emit("writeup", "done", "статья написана", idea_id=idea["Name"])
            return True
        except StageSkip:
            self.set_status(idea, "writeup_failed", "writeup skipped by guard")
            self._emit("writeup", "fail", "статья пропущена guard'ом", idea_id=idea["Name"])
            return False
        except RunAborted:
            self._emit("writeup", "fail", "статья прервана", idea_id=idea["Name"])
            raise
        except Exception as e:
            guard.failure(str(e))
            self.set_status(idea, "writeup_failed", str(e)[:200])
            self._emit("writeup", "fail", str(e), idea_id=idea["Name"],
                       detail={"error": str(e)[:300]})
            return False

    @staticmethod
    def _review_score(review: dict) -> float | None:
        try:
            v = review.get("Overall")
            return float(str(v).split("/")[0]) if v is not None else None
        except (ValueError, TypeError, AttributeError):
            return None

    def _run_review(self, idea, folder_name, pdf, r_client, r_model, ensemble, guard):
        paper_text = load_paper(pdf)
        review = perform_review(paper_text, model=r_model, client=r_client,
                                num_reflections=5, num_fs_examples=1,
                                num_reviews_ensemble=ensemble, temperature=0.1)
        with open(osp.join(folder_name, "review.txt"), "w") as f:
            f.write(json.dumps(review, indent=4))
        guard.success()
        return review

    def stage_review(self, idea, folder_name):
        import openai
        guard = StageGuard(f"review:{idea['Name']}")
        pdf = osp.join(folder_name, f"{idea['Name']}.pdf")
        self._emit("review", "started", f"рецензия для «{idea['Name']}»",
                   idea_id=idea["Name"])
        try:
            review_model = os.environ.get("AISC_REVIEW_MODEL", "")
            if review_model:
                r_client, r_model = create_client(review_model)
                ensemble = 1
            elif os.environ.get("OPENAI_API_KEY"):
                r_client, r_model, ensemble = openai.OpenAI(), "gpt-4o-2024-05-13", 5
            else:
                r_client, r_model, ensemble = self.client, self.client_model, 1
                self.log("OPENAI_API_KEY не задан — ревью основной моделью без ансамбля.")
            self.log(f"*Рецензия* для «{idea['Name']}» ({r_model}, ensemble={ensemble})")
            review = self._run_review(idea, folder_name, pdf, r_client, r_model, ensemble, guard)
            score = self._review_score(review)
            if score is not None:
                self._last_review_score[idea["Name"]] = score

            # Review fix loop: a weak paper gets one repair round per
            # AISC_REVIEW_FIX_ITER — the reviewer's verdict goes back to the
            # coder, the paper is fixed, recompiled and re-reviewed.
            min_score = float(os.environ.get("AISC_REVIEW_MIN_SCORE", "0") or 0)
            fix_iters = int(os.environ.get("AISC_REVIEW_FIX_ITER", "0") or 0)
            for it in range(fix_iters):
                if min_score <= 0 or score is None or score >= min_score:
                    break
                self.log(f"Ревью {score}/10 < {min_score} — раунд правок {it + 1}/{fix_iters}")
                self._emit("review", "log",
                           f"score {score}/10 — правки статьи ({it + 1}/{fix_iters})",
                           idea_id=idea["Name"])
                try:
                    tex = osp.join(folder_name, "latex", "template.tex")
                    coder = self._make_coder(folder_name, idea, [tex])
                    coder.run(
                        "The paper received the following reviewer feedback:\n"
                        f"{json.dumps(review, indent=2)[:4000]}\n\n"
                        "Revise latex/template.tex to address the weaknesses "
                        "(clarity, missing details, overstated claims). Do not invent new results."
                    )
                    from ai_scientist.perform_writeup import compile_latex
                    compile_latex(osp.join(folder_name, "latex"), pdf)
                    if osp.exists(pdf):
                        review = self._run_review(idea, folder_name, pdf,
                                                  r_client, r_model, ensemble, guard)
                        score = self._review_score(review)
                        if score is not None:
                            self._last_review_score[idea["Name"]] = score
                            self.log(f"Повторное ревью: {score}/10")
                except Exception as e:
                    self.log(f"Раунд правок не удался: {e}")
                    break

            obsidian_notes.update_idea_status(self.template, idea["Name"], "reviewed",
                                              checklist={"Рецензия": True}, review=review)
            self._emit("review", "done",
                       f"рецензия сохранена в review.txt (score={score if score is not None else '—'})",
                       idea_id=idea["Name"])
            return True
        except StageSkip:
            self.set_status(idea, "reviewed", "review skipped by guard")
            self._emit("review", "fail", "рецензия пропущена guard'ом", idea_id=idea["Name"])
            return False
        except RunAborted:
            self._emit("review", "fail", "рецензия прервана", idea_id=idea["Name"])
            raise
        except Exception as e:
            guard.failure(str(e))
            self.set_status(idea, "review_failed", str(e)[:200])
            self._emit("review", "fail", str(e), idea_id=idea["Name"],
                       detail={"error": str(e)[:300]})
            return False

    # ------------------------------------------------------------------ resume
    def _idea_from_folder(self, folder_name: str) -> dict:
        """Восстанавливает идею по папке прогона (results/<template>/<ts>_<Name>)."""
        base = osp.basename(osp.normpath(folder_name))
        name = base.split("_", 2)[2] if base.count("_") >= 2 else base

        for cand in (osp.join(folder_name, "ideas.json"), osp.join(self.base_dir, "ideas.json")):
            try:
                with open(cand, encoding="utf-8") as f:
                    for idea in json.load(f):
                        if isinstance(idea, dict) and idea.get("Name") == name:
                            return idea
            except Exception:
                continue

        # Фолбэк: собрать минимальную идею из notes.txt
        title, experiment = name, ""
        notes_path = osp.join(folder_name, "notes.txt")
        if osp.exists(notes_path):
            with open(notes_path, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if line.startswith("# Title:"):
                        title = line.split(":", 1)[1].strip() or title
                    elif line.startswith("# Experiment description:"):
                        experiment = line.split(":", 1)[1].strip()
        return {"Name": name, "Title": title, "Experiment": experiment or "(из notes.txt)"}

    def resume_run(self, folder_name: str, stages: set) -> dict:
        """Продолжение существующего прогона (writeup/review по папке results)."""
        folder_name = osp.abspath(folder_name)
        if not osp.isdir(folder_name):
            raise FileNotFoundError(folder_name)
        self.log(f"▶ Продолжение прогона: {folder_name} (этапы: {', '.join(sorted(stages))})")
        idea = self._idea_from_folder(folder_name)
        name = idea["Name"]
        notes = osp.join(folder_name, "notes.txt")
        if not osp.exists(notes):
            raise FileNotFoundError(f"{notes} — невозможно продолжить без notes.txt")

        ok_writeup = osp.exists(osp.join(folder_name, "latex", "template.tex"))
        ok_review = osp.exists(osp.join(folder_name, f"{name}.pdf"))
        if "writeup" in stages:
            self.stage_writeup(idea, folder_name, notes)
            ok_review = osp.exists(osp.join(folder_name, f"{name}.pdf"))
        if "review" in stages and ok_review:
            self.stage_review(idea, folder_name)
        elif "review" in stages and not ok_review:
            self.log(f"PDF «{name}.pdf» не найден — ревью невозможно (сначала writeup).")
        status = "reviewed" if (osp.exists(osp.join(folder_name, "review.txt"))
                                and ok_review) else "writeup"
        self.set_status(idea, status)
        self.write_overview()
        return {"run_id": self.run_id, "resumed_folder": folder_name,
                "statuses": self.statuses, "aborted": False}

    # ------------------------------------------------------------------ notes
    def write_overview(self):
        try:
            obsidian_notes.write_run_overview(
                self.template, self.run_id, self.model,
                ideas=self._ideas_from_json(),
                statuses=self.statuses,
                results_dir=self.results_dir,
                notes="\n".join(self.journal_lines[-40:]),
            )
        except Exception as e:
            print(f"(Obsidian overview не записан: {e})")

    def _ideas_from_json(self):
        try:
            with open(osp.join(self.base_dir, "ideas.json"), encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
