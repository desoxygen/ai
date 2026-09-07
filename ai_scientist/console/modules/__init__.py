"""Каталог модулей консоли (как `modules/` в Metasploit).

Каждый модуль — файл в подпакете `ai_scientist.console.modules.<type>/<name>.py`,
экспортирующий:

  MANIFEST = {                        # обязательный, лёгкий (без тяжёлых импортов)
      "type": "pipeline",             # auxiliary|generate|pipeline|review|report
      "description": "...",
      "options": {                    # NAME -> {"required", "type", "default", "choices"}
          "TEMPLATE": {"required": True, "type": "str"},
      },
  }

  def run(options, job, emit, stop_event=None) -> dict:
      ...   # тяжёлые импорты — внутри функции
"""
