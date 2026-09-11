import json
import os
import re

import anthropic
import backoff
import openai
from ai_scientist import loop_guard, settings

MAX_NUM_TOKENS = 4096

AVAILABLE_LLMS = [
    # Anthropic models
    "claude-3-5-sonnet-20240620",
    "claude-3-5-sonnet-20241022",
    # OpenAI models
    "gpt-4o-mini",
    "gpt-4o-mini-2024-07-18",
    "gpt-4o",
    "gpt-4o-2024-05-13",
    "gpt-4o-2024-08-06",
    "gpt-4.1",
    "gpt-4.1-2025-04-14",
    "gpt-4.1-mini",
    "gpt-4.1-mini-2025-04-14",
    "gpt-4.1-nano",
    "gpt-4.1-nano-2025-04-14",
    "o1",
    "o1-2024-12-17",
    "o1-preview-2024-09-12",
    "o1-mini",
    "o1-mini-2024-09-12",
    "o3-mini",
    "o3-mini-2025-01-31",
    # OpenRouter models
    "llama3.1-405b",
    "openrouter/meta-llama/llama-3.3-70b-instruct",
    "openrouter/deepseek/deepseek-chat",
    "openrouter/openai/gpt-4o-mini",
    # Anthropic Claude models via Amazon Bedrock
    "bedrock/anthropic.claude-3-sonnet-20240229-v1:0",
    "bedrock/anthropic.claude-3-5-sonnet-20240620-v1:0",
    "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0",
    "bedrock/anthropic.claude-3-haiku-20240307-v1:0",
    "bedrock/anthropic.claude-3-opus-20240229-v1:0",
    # Anthropic Claude models Vertex AI
    "vertex_ai/claude-3-opus@20240229",
    "vertex_ai/claude-3-5-sonnet@20240620",
    "vertex_ai/claude-3-5-sonnet-v2@20241022",
    "vertex_ai/claude-3-sonnet@20240229",
    "vertex_ai/claude-3-haiku@20240307",
    # DeepSeek models
    "deepseek-chat",
    "deepseek-coder",
    "deepseek-reasoner",
    # Google Gemini models
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash-thinking-exp-01-21",
    "gemini-2.5-pro-preview-03-25",
    "gemini-2.5-pro-exp-03-25",
]


def _llm_backoff_notice(details):
    tries = details["tries"]
    print(f"[loop-guard] LLM retry {tries}/{settings.GUARD.llm_max_tries} "
          f"через {details['wait']:.1f}с ({details['target'].__name__})")


# Get N responses from a single message, used for ensembling.
@backoff.on_exception(
    backoff.expo,
    (openai.RateLimitError, openai.APITimeoutError,
     anthropic.RateLimitError, anthropic.APITimeoutError),
    max_tries=settings.GUARD.llm_max_tries,
    on_backoff=_llm_backoff_notice,
)
def _get_batch_responses_from_llm_raw(
        msg,
        client,
        model,
        system_message,
        print_debug=False,
        msg_history=None,
        temperature=0.75,
        n_responses=1,
):
    if msg_history is None:
        msg_history = []

    if model.startswith("openrouter/"):
        # OpenRouter: ансамбль через последовательные одиночные вызовы
        # (многие модели не поддерживают n>1).
        content, new_msg_history = [], []
        for _ in range(n_responses):
            c, hist = get_response_from_llm(
                msg,
                client,
                model,
                system_message,
                print_debug=False,
                msg_history=None,
                temperature=temperature,
            )
            content.append(c)
            new_msg_history.append(hist)
    elif 'gpt' in model:
        new_msg_history = msg_history + [{"role": "user", "content": msg}]
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_message},
                *new_msg_history,
            ],
            temperature=temperature,
            max_tokens=MAX_NUM_TOKENS,
            n=n_responses,
            stop=None,
            seed=0,
        )
        content = [r.message.content for r in response.choices]
        new_msg_history = [
            new_msg_history + [{"role": "assistant", "content": c}] for c in content
        ]
    elif model == "llama-3-1-405b-instruct":
        new_msg_history = msg_history + [{"role": "user", "content": msg}]
        response = client.chat.completions.create(
            model="meta-llama/llama-3.1-405b-instruct",
            messages=[
                {"role": "system", "content": system_message},
                *new_msg_history,
            ],
            temperature=temperature,
            max_tokens=MAX_NUM_TOKENS,
            n=n_responses,
            stop=None,
        )
        content = [r.message.content for r in response.choices]
        new_msg_history = [
            new_msg_history + [{"role": "assistant", "content": c}] for c in content
        ]
    else:
        content, new_msg_history = [], []
        for _ in range(n_responses):
            c, hist = get_response_from_llm(
                msg,
                client,
                model,
                system_message,
                print_debug=False,
                msg_history=None,
                temperature=temperature,
            )
            content.append(c)
            new_msg_history.append(hist)

    if print_debug:
        print()
        print("*" * 20 + " LLM START " + "*" * 20)
        for j, msg in enumerate(new_msg_history[0]):
            print(f'{j}, {msg["role"]}: {msg["content"]}')
        print(content)
        print("*" * 21 + " LLM END " + "*" * 21)
        print()

    return content, new_msg_history


@backoff.on_exception(
    backoff.expo,
    (openai.RateLimitError, openai.APITimeoutError,
     anthropic.RateLimitError, anthropic.APITimeoutError),
    max_tries=settings.GUARD.llm_max_tries,
    on_backoff=_llm_backoff_notice,
)
def _get_response_from_llm_raw(
        msg,
        client,
        model,
        system_message,
        print_debug=False,
        msg_history=None,
        temperature=0.75,
):
    if msg_history is None:
        msg_history = []

    if model.startswith("openrouter/"):
        # Generic OpenRouter model: any id from https://openrouter.ai/models
        new_msg_history = msg_history + [{"role": "user", "content": msg}]
        response = client.chat.completions.create(
            model=model.split("/", 1)[1],
            messages=[
                {"role": "system", "content": system_message},
                *new_msg_history,
            ],
            temperature=temperature,
            max_tokens=MAX_NUM_TOKENS,
            n=1,
            stop=None,
        )
        content = response.choices[0].message.content
        new_msg_history = new_msg_history + [{"role": "assistant", "content": content}]
    elif "claude" in model:
        new_msg_history = msg_history + [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": msg,
                    }
                ],
            }
        ]
        response = client.messages.create(
            model=model,
            max_tokens=MAX_NUM_TOKENS,
            temperature=temperature,
            system=system_message,
            messages=new_msg_history,
        )
        content = response.content[0].text
        new_msg_history = new_msg_history + [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "text",
                        "text": content,
                    }
                ],
            }
        ]
    elif 'gpt' in model:
        new_msg_history = msg_history + [{"role": "user", "content": msg}]
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_message},
                *new_msg_history,
            ],
            temperature=temperature,
            max_tokens=MAX_NUM_TOKENS,
            n=1,
            stop=None,
            seed=0,
        )
        content = response.choices[0].message.content
        new_msg_history = new_msg_history + [{"role": "assistant", "content": content}]
    elif "o1" in model or "o3" in model:
        new_msg_history = msg_history + [{"role": "user", "content": msg}]
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "user", "content": system_message},
                *new_msg_history,
            ],
            temperature=1,
            max_completion_tokens=MAX_NUM_TOKENS,
            n=1,
            seed=0,
        )
        content = response.choices[0].message.content
        new_msg_history = new_msg_history + [{"role": "assistant", "content": content}]
    elif model in ["meta-llama/llama-3.1-405b-instruct", "llama-3-1-405b-instruct"]:
        new_msg_history = msg_history + [{"role": "user", "content": msg}]
        response = client.chat.completions.create(
            model="meta-llama/llama-3.1-405b-instruct",
            messages=[
                {"role": "system", "content": system_message},
                *new_msg_history,
            ],
            temperature=temperature,
            max_tokens=MAX_NUM_TOKENS,
            n=1,
            stop=None,
        )
        content = response.choices[0].message.content
        new_msg_history = new_msg_history + [{"role": "assistant", "content": content}]
    elif model in ["deepseek-chat", "deepseek-coder"]:
        new_msg_history = msg_history + [{"role": "user", "content": msg}]
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_message},
                *new_msg_history,
            ],
            temperature=temperature,
            max_tokens=MAX_NUM_TOKENS,
            n=1,
            stop=None,
        )
        content = response.choices[0].message.content
        new_msg_history = new_msg_history + [{"role": "assistant", "content": content}]
    elif model in ["deepseek-reasoner"]:
        new_msg_history = msg_history + [{"role": "user", "content": msg}]
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_message},
                *new_msg_history,
            ],
            n=1,
            stop=None,
        )
        content = response.choices[0].message.content
        new_msg_history = new_msg_history + [{"role": "assistant", "content": content}]
    elif "gemini" in model:
        new_msg_history = msg_history + [{"role": "user", "content": msg}]
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_message},
                *new_msg_history,
            ],
            temperature=temperature,
            max_tokens=MAX_NUM_TOKENS,
            n=1,
        )
        content = response.choices[0].message.content
        new_msg_history = new_msg_history + [{"role": "assistant", "content": content}]
    elif model.startswith("ollama/"):
        # Local Ollama: generic OpenAI-compatible chat (no seed/n params)
        new_msg_history = msg_history + [{"role": "user", "content": msg}]
        response = client.chat.completions.create(
            model=model.split("/", 1)[1],
            messages=[
                {"role": "system", "content": system_message},
                *new_msg_history,
            ],
            temperature=temperature,
            max_tokens=MAX_NUM_TOKENS,
            stop=None,
        )
        content = response.choices[0].message.content
        new_msg_history = new_msg_history + [{"role": "assistant", "content": content}]
    else:
        raise ValueError(f"Model {model} not supported.")

    if print_debug:
        print()
        print("*" * 20 + " LLM START " + "*" * 20)
        for j, msg in enumerate(new_msg_history):
            print(f'{j}, {msg["role"]}: {msg["content"]}')
        print(content)
        print("*" * 21 + " LLM END " + "*" * 21)
        print()

    return content, new_msg_history


def get_response_from_llm(
        msg,
        client,
        model,
        system_message,
        print_debug=False,
        msg_history=None,
        temperature=0.75,
):
    """Public wrapper: tracks consecutive LLM failures for the loop guard."""
    try:
        content, new_msg_history = _get_response_from_llm_raw(
            msg, client, model, system_message, print_debug=print_debug,
            msg_history=msg_history, temperature=temperature,
        )
        loop_guard.reset_llm_streak()
        return content, new_msg_history
    except Exception as e:
        loop_guard.note_llm_failure(model, e)
        raise


def get_batch_responses_from_llm(
        msg,
        client,
        model,
        system_message,
        print_debug=False,
        msg_history=None,
        temperature=0.75,
        n_responses=1,
):
    """Public wrapper: tracks consecutive LLM failures for the loop guard."""
    try:
        content, new_msg_history = _get_batch_responses_from_llm_raw(
            msg, client, model, system_message, print_debug=print_debug,
            msg_history=msg_history, temperature=temperature, n_responses=n_responses,
        )
        loop_guard.reset_llm_streak()
        return content, new_msg_history
    except Exception as e:
        loop_guard.note_llm_failure(model, e)
        raise


def extract_json_between_markers(llm_output):
    # Regular expression pattern to find JSON content between ```json and ```
    json_pattern = r"```json(.*?)```"
    matches = re.findall(json_pattern, llm_output, re.DOTALL)

    if not matches:
        # Fallback: Try to find any JSON-like content in the output
        json_pattern = r"\{.*?\}"
        matches = re.findall(json_pattern, llm_output, re.DOTALL)

    for json_string in matches:
        json_string = json_string.strip()
        try:
            parsed_json = json.loads(json_string)
            return parsed_json
        except json.JSONDecodeError:
            # Attempt to fix common JSON issues
            try:
                # Remove invalid control characters
                json_string_clean = re.sub(r"[\x00-\x1F\x7F]", "", json_string)
                parsed_json = json.loads(json_string_clean)
                return parsed_json
            except json.JSONDecodeError:
                continue  # Try next match

    # Last resort: scan for balanced JSON objects (handles nested braces that
    # the non-greedy regex above cuts off).
    decoder = json.JSONDecoder()
    for idx, ch in enumerate(llm_output):
        if ch == "{":
            try:
                parsed, _ = decoder.raw_decode(llm_output[idx:])
                return parsed
            except json.JSONDecodeError:
                continue

    return None  # No valid JSON found


def create_client(model):
    if model.startswith("openrouter/"):
        print(f"Using OpenRouter with {model}.")
        return openai.OpenAI(
            api_key=os.environ["OPENROUTER_API_KEY"],
            base_url="https://openrouter.ai/api/v1"
        ), model
    elif model.startswith("ollama/"):
        # Local Ollama server (OpenAI-compatible endpoint on :11434).
        # The full prefixed name is kept — the dispatcher strips it itself.
        name = model.split("/", 1)[1]
        print(f"Using local Ollama with {name}.")
        return openai.OpenAI(
            api_key="ollama",
            base_url=os.environ.get("OLLAMA_HOST", "http://localhost:11434") + "/v1",
        ), model
    elif model.startswith("claude-"):
        print(f"Using Anthropic API with model {model}.")
        return anthropic.Anthropic(), model
    elif model.startswith("bedrock") and "claude" in model:
        client_model = model.split("/")[-1]
        print(f"Using Amazon Bedrock with model {client_model}.")
        return anthropic.AnthropicBedrock(), client_model
    elif model.startswith("vertex_ai") and "claude" in model:
        client_model = model.split("/")[-1]
        print(f"Using Vertex AI with model {client_model}.")
        return anthropic.AnthropicVertex(), client_model
    elif 'gpt' in model or "o1" in model or "o3" in model:
        print(f"Using OpenAI API with model {model}.")
        return openai.OpenAI(), model
    elif model in ["deepseek-chat", "deepseek-reasoner", "deepseek-coder"]:
        print(f"Using OpenAI API with {model}.")
        return openai.OpenAI(
            api_key=os.environ["DEEPSEEK_API_KEY"],
            base_url="https://api.deepseek.com"
        ), model
    elif model == "llama3.1-405b":
        print(f"Using OpenAI API with {model}.")
        return openai.OpenAI(
            api_key=os.environ["OPENROUTER_API_KEY"],
            base_url="https://openrouter.ai/api/v1"
        ), "meta-llama/llama-3.1-405b-instruct"
    elif "gemini" in model:
        print(f"Using OpenAI API with {model}.")
        return openai.OpenAI(
            api_key=os.environ["GEMINI_API_KEY"],
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
        ), model
    else:
        raise ValueError(f"Model {model} not supported.")
