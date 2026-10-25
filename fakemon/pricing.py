"""Cost estimates from API usage. Rates are USD list prices (developers.openai.com/api/docs/pricing, Oct 2026).

The estimate feeds the monthly budget guard and the grown-ups page. OpenAI's own usage
dashboard is the source of truth; set a project spend limit there as the hard backstop.
"""

from __future__ import annotations

PER_MILLION = 1_000_000

# model -> (text input, image input, output) per 1M tokens
IMAGE_RATES = {
    "gpt-image-2.5-flare": (5.00, 8.00, 30.00),
    "gpt-image-2.5-sunburst": (5.00, 8.00, 30.00),
    "gpt-image-2": (5.00, 8.00, 30.00),
}

# model -> (input, output) per 1M tokens
TEXT_RATES = {
    "gpt-6-luna": (0.10, 0.50),
    "gpt-6.1-sol": (2.00, 10.00),
    "gpt-5-mini": (0.25, 2.00),
    "gpt-5-nano": (0.05, 0.40),
}

# model -> USD per audio minute
TRANSCRIBE_PER_MINUTE = {
    "gpt-transcribe": 0.0045,
    "gpt-4o-transcribe": 0.006,
    "gpt-4o-mini-transcribe": 0.003,
    "whisper-1": 0.006,
}


class UnknownModelPrice(KeyError):
    """Raised when a configured model has no rate; add it above rather than guessing."""


def image_cost(model: str, text_in: int, image_in: int, out: int) -> float:
    try:
        text_rate, image_rate, out_rate = IMAGE_RATES[model]
    except KeyError as exc:
        raise UnknownModelPrice(model) from exc
    return (text_in * text_rate + image_in * image_rate + out * out_rate) / PER_MILLION


def text_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    try:
        in_rate, out_rate = TEXT_RATES[model]
    except KeyError as exc:
        raise UnknownModelPrice(model) from exc
    return (tokens_in * in_rate + tokens_out * out_rate) / PER_MILLION


def transcribe_cost(model: str, seconds: float) -> float:
    try:
        rate = TRANSCRIBE_PER_MINUTE[model]
    except KeyError as exc:
        raise UnknownModelPrice(model) from exc
    return seconds / 60.0 * rate


def check_known(*, image_model: str, text_model: str, transcribe_model: str) -> None:
    """Fail at startup instead of silently under-counting spend."""
    for table, model in (
        (IMAGE_RATES, image_model),
        (TEXT_RATES, text_model),
        (TRANSCRIBE_PER_MINUTE, transcribe_model),
    ):
        if model not in table:
            raise UnknownModelPrice(f"no price for {model!r}; add it to fakemon/pricing.py")
