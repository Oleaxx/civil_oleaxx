"""
AI Note-Summarizer & Quiz Generator Dashboard
=============================================

A single-file Streamlit app that turns raw study notes into an executive summary,
interactive flashcards and a graded multiple-choice practice quiz, with a floating
scratchpad calculator that stays available on every tab.

Setup
-----
    pip install "streamlit>=1.39" openai google-generativeai
    streamlit run app.py

Notes
-----
* Streamlit 1.39+ is needed for keyed containers (`st.container(key=...)`), which the
  floating calculator uses for its fixed-position CSS. On older versions the calculator
  still works, it just renders inline instead of floating.
* No API key? Click "Simulate Demo Notes" in the sidebar to load hardcoded engineering
  demo data (summary, flashcards and a 3-question math quiz) without any API call.
* Model IDs live in MODEL_TIERS below. Edit them there, or use the sidebar's
  "custom model ID" override, when providers release or retire models.
"""

import ast
import copy
import html
import json
import math
import operator
import re

import streamlit as st

# Optional provider SDKs: the app (and its demo mode) still runs if one is missing.
try:
    from openai import OpenAI
except Exception:  # pragma: no cover
    OpenAI = None

try:
    import google.generativeai as genai
except Exception:  # pragma: no cover
    genai = None


# ---------------------------------------------------------------------------
# Page configuration (must be the first Streamlit command)
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="AI Note-Summarizer & Quiz Generator",
    page_icon="🧠",
    layout="wide",
    initial_sidebar_state="expanded",
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MODEL_TIERS = {
    "OpenAI": {
        "⚡ Fast & economical": "gpt-4.1-mini",
        "⚖️ Balanced": "gpt-4.1",
        "🧠 Advanced reasoning": "gpt-5",
    },
    "Google Gemini": {
        "⚡ Fast & economical": "gemini-2.5-flash-lite",
        "⚖️ Balanced": "gemini-2.5-flash",
        "🧠 Advanced reasoning": "gemini-2.5-pro",
    },
}

MAX_NOTE_CHARS = 24000
LETTERS = ["A", "B", "C", "D"]
NO_KEY_MESSAGE = "Please enter your API Key in the sidebar to activate the AI engines."

SUMMARY_SYSTEM_PROMPT = """You are an expert study coach who turns raw notes into crisp study material.

Return ONLY one valid JSON object (no markdown fences, no commentary) with exactly this schema:
{
  "summary": ["bullet 1", "bullet 2", "..."],
  "flashcards": [
    {"question": "...", "answer": "..."}
  ]
}

Rules:
- "summary" is the Executive Summary: 5 to 8 punchy bullet strings. Each bullet explains one
  complex concept in plain language, preferably with a simple everyday analogy, and includes the
  key metrics, numbers, formulas or definitions that appear in the notes. Use **bold** for the term.
- "flashcards" contains between 5 and 10 cards. Each question must be self-contained and each
  answer concise (1-3 sentences).
- Use only information supported by the notes. Never invent facts or figures.
- Do not include any text outside the JSON object."""

QUIZ_SYSTEM_PROMPT_TEMPLATE = """You are an expert exam writer. Create a multiple-choice practice test from the user's notes.

Return ONLY one valid JSON object (no markdown fences, no commentary) with exactly this schema:
{{
  "questions": [
    {{
      "question": "Question text",
      "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}},
      "correct_answer": "A",
      "explanation": "Short step-by-step reasoning that shows why the correct option is right."
    }}
  ]
}}

Strict rules:
- Produce exactly {n} questions.
- Every question has exactly four options keyed "A", "B", "C" and "D".
- "correct_answer" is a single letter: "A", "B", "C" or "D". Exactly one option is correct.
- Vary which letter is correct across the questions. Make distractors plausible, not silly.
- "explanation" is 1-4 sentences of step-by-step logic (show the calculation for numeric questions).
- Base every question on the notes. Do not include any text outside the JSON object."""


# ---------------------------------------------------------------------------
# Demo data (hardcoded mock engineering content, no API needed)
# ---------------------------------------------------------------------------
DEMO_NOTES = """Circuit Analysis Crash Course (Electrical Engineering 101)

Ohm's Law: V = I x R. A 12 V source across a 4 ohm resistor drives 3 A of current.

Series circuits: the same current flows through every component, and resistances add.
Example: 100 + 220 + 330 = 650 ohm.

Parallel circuits: voltage is the same across every branch, and conductances add.
1/Rtotal = 1/R1 + 1/R2 + ... For two resistors, Rtotal = (R1 x R2) / (R1 + R2).
Example: 6 ohm in parallel with 3 ohm gives 2 ohm.

Power: P = V x I = I^2 x R = V^2 / R. A 3 A current through 4 ohm dissipates 36 W as heat.

Kirchhoff's Current Law (KCL): the currents entering a node sum to the currents leaving it.
Kirchhoff's Voltage Law (KVL): the voltages around any closed loop sum to zero.

RC circuits: the time constant is tau = R x C. After 1 tau a charging capacitor reaches about
63.2% of the source voltage, and after 5 tau about 99.3% (treated as fully charged).
Example: 10 kilo-ohm and 100 microfarad give tau = 1 s."""

DEMO_SUMMARY = """- **Ohm's Law (V = I × R)**: Think of a water pipe. Voltage is the water pressure, current is the flow rate and resistance is how narrow the pipe is. *Key metric:* 12 V across 4 Ω drives **3 A**.
- **Series circuits**: A single-lane road where every car passes every checkpoint. Current is identical everywhere and resistances simply add: 100 + 220 + 330 = **650 Ω**.
- **Parallel circuits**: Several checkout lanes open at once. More paths mean less total resistance, so 6 Ω ∥ 3 Ω = **2 Ω**. Shortcut for two resistors: product over sum.
- **Power (P = V × I = I²R)**: The heat bill your circuit pays. 3 A through 4 Ω burns **36 W**, so resistor power ratings matter.
- **Kirchhoff's Laws**: KCL is a roundabout: whatever flows in must flow out. KVL is a hiking loop: total climbs and descents sum to **zero** by the time you are back at the start.
- **RC time constant (τ = R × C)**: Filling a bucket through a thin hose. After **1τ** the capacitor holds about **63.2%** of the source voltage and after **5τ** about **99.3%**. For 10 kΩ and 100 µF, τ = **1 s**."""

DEMO_FLASHCARDS = [
    {
        "question": "State Ohm's Law and define each term.",
        "answer": "V = I × R, where V is voltage (volts), I is current (amps) and R is resistance (ohms).",
    },
    {
        "question": "How do you find the total resistance of resistors in series?",
        "answer": "Add them: R_total = R1 + R2 + R3. Example: 100 + 220 + 330 = 650 Ω.",
    },
    {
        "question": "What is the shortcut formula for two resistors in parallel?",
        "answer": "R_total = (R1 × R2) / (R1 + R2). Example: (6 × 3) / (6 + 3) = 2 Ω.",
    },
    {
        "question": "Give three equivalent formulas for electrical power.",
        "answer": "P = V × I = I² × R = V² / R. Example: 3 A through 4 Ω dissipates 36 W.",
    },
    {
        "question": "What does Kirchhoff's Current Law (KCL) say?",
        "answer": "The total current entering any node equals the total current leaving it.",
    },
    {
        "question": "What does Kirchhoff's Voltage Law (KVL) say?",
        "answer": "The voltages around any closed loop in a circuit sum to zero.",
    },
    {
        "question": "What is the RC time constant, and how much charge is reached after 1τ?",
        "answer": "τ = R × C. After 1τ a charging capacitor reaches about 63.2% of the source voltage.",
    },
    {
        "question": "After how many time constants is a capacitor considered fully charged?",
        "answer": "About 5τ, when it has reached roughly 99.3% of the source voltage.",
    },
]

DEMO_QUIZ = [
    {
        "question": "A 4 Ω resistor is connected across a 12 V source. What current flows through it?",
        "options": {"A": "0.33 A", "B": "3 A", "C": "8 A", "D": "48 A"},
        "correct": "B",
        "explanation": (
            "Apply Ohm's Law: I = V / R. Step 1: V = 12 V and R = 4 Ω. "
            "Step 2: I = 12 / 4 = 3 A. Option A comes from flipping the fraction (4 / 12)."
        ),
    },
    {
        "question": "What is the equivalent resistance of a 6 Ω and a 3 Ω resistor connected in parallel?",
        "options": {"A": "9 Ω", "B": "4.5 Ω", "C": "2 Ω", "D": "18 Ω"},
        "correct": "C",
        "explanation": (
            "For two parallel resistors, R = (R1 × R2) / (R1 + R2). Step 1: product = 6 × 3 = 18. "
            "Step 2: sum = 6 + 3 = 9. Step 3: R = 18 / 9 = 2 Ω. Parallel resistance is always "
            "smaller than the smallest branch, which rules out 9 Ω, 4.5 Ω and 18 Ω."
        ),
    },
    {
        "question": "An RC circuit uses R = 10 kΩ and C = 100 µF. What is its time constant τ?",
        "options": {"A": "1 s", "B": "0.1 s", "C": "10 s", "D": "1000 s"},
        "correct": "A",
        "explanation": (
            "Use τ = R × C. Step 1: convert units, R = 10,000 Ω and C = 100 × 10⁻⁶ F = 0.0001 F. "
            "Step 2: τ = 10,000 × 0.0001 = 1 s."
        ),
    },
]


# ---------------------------------------------------------------------------
# Custom CSS (floating calculator, quiz feedback)
# ---------------------------------------------------------------------------
# Note: no blank lines or 4-space indents in this block, so the Markdown parser
# does not break out of the <style> element.
APP_CSS = """<style>
.block-container { padding-bottom: 7rem; }
.st-key-calc_toggle { position: fixed; bottom: 18px; right: 18px; width: 200px !important; z-index: 1000001; }
.st-key-calc_toggle button { background: #0f766e; border: 1px solid #14b8a6; border-radius: 999px; padding: 0.5rem 1rem; width: 100%; box-shadow: 0 6px 18px rgba(15, 118, 110, 0.45); }
.st-key-calc_toggle button p { color: #f0fdfa; font-weight: 600; }
.st-key-calc_toggle button:hover { background: #115e59; border-color: #2dd4bf; }
.st-key-calc_panel { position: fixed; bottom: 78px; right: 18px; width: 304px !important; max-width: calc(100vw - 36px); max-height: calc(100vh - 110px); overflow-y: auto; z-index: 1000000; background: #14202b; border: 1px solid #2b3d4d; border-radius: 16px; padding: 14px 14px 12px 14px; gap: 0.5rem !important; box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5); }
.st-key-calc_panel [data-testid="stHorizontalBlock"] { flex-wrap: nowrap !important; gap: 0.4rem !important; }
.st-key-calc_panel [data-testid="stColumn"], .st-key-calc_panel [data-testid="column"] { min-width: 0 !important; width: auto !important; flex: 1 1 0 !important; }
.st-key-calc_panel button { background: #22313f; border: 1px solid #34495c; border-radius: 10px; min-height: 2.4rem; width: 100%; padding: 0; }
.st-key-calc_panel button p { color: #e8eef3; font-size: 1.05rem; font-weight: 600; margin: 0; }
.st-key-calc_panel button:hover { background: #2c4052; border-color: #4b6a84; }
.st-key-calc_panel [class*="st-key-calc_op_"] button { background: #3a2f12; border-color: #7a6425; }
.st-key-calc_panel [class*="st-key-calc_op_"] button p { color: #fcd34d; }
.st-key-calc_panel .st-key-calc_btn_clear button { background: #4a1f24; border-color: #8f3a43; }
.st-key-calc_panel .st-key-calc_btn_clear button p { color: #fecaca; }
.st-key-calc_panel .st-key-calc_btn_eq button { background: #0f766e; border-color: #14b8a6; }
.st-key-calc_panel .st-key-calc_btn_eq button p { color: #f0fdfa; }
.calc-title { color: #e8eef3; font-weight: 600; font-size: 0.95rem; }
.calc-display { background: #0b141c; border: 1px solid #2b3d4d; border-radius: 12px; padding: 8px 12px; text-align: right; min-height: 66px; }
.calc-last { color: #8aa0b2; font-size: 0.78rem; min-height: 1.1rem; }
.calc-last.err { color: #f87171; }
.calc-current { color: #f8fafc; font-size: 1.7rem; font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all; line-height: 1.25; }
.calc-history { color: #8aa0b2; font-size: 0.75rem; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; text-align: right; line-height: 1.5; }
.fb { padding: 0.6rem 0.9rem; border-radius: 10px; margin: 0.3rem 0; border-left: 5px solid; }
.fb-correct { background: rgba(34, 197, 94, 0.15); border-color: #22c55e; }
.fb-wrong { background: rgba(239, 68, 68, 0.15); border-color: #ef4444; }
.fb-skipped { background: rgba(245, 158, 11, 0.15); border-color: #f59e0b; }
</style>"""


def inject_css():
    st.markdown(APP_CSS, unsafe_allow_html=True)


# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------
DEFAULT_STATE = {
    # Notes + AI outputs
    "notes_input": "",
    "active_notes": "",
    "uploader_key": 0,
    "summary": "",
    "flashcards": [],
    "summary_source": None,  # "demo" | "ai" | None
    # Quiz
    "quiz": [],
    "quiz_id": 0,
    "quiz_submitted": False,
    "quiz_source": None,  # "demo" | "ai" | None
    # Calculator
    "calc_open": False,
    "calc_expr": "",
    "calc_last": "",
    "calc_msg": "",
    "calc_fresh": False,
    "calc_history": [],
}


def init_state():
    for key, value in DEFAULT_STATE.items():
        if key not in st.session_state:
            st.session_state[key] = copy.deepcopy(value)


def cleanup_quiz_widget_keys():
    """Remove stale radio answers so a new/retaken quiz starts blank."""
    for key in list(st.session_state.keys()):
        if isinstance(key, str) and key.startswith("quizans_"):
            del st.session_state[key]


def load_demo_data():
    """Callback: populate every output with hardcoded mock engineering data (no API call)."""
    s = st.session_state
    cleanup_quiz_widget_keys()
    s.notes_input = DEMO_NOTES
    s.summary = DEMO_SUMMARY
    s.flashcards = copy.deepcopy(DEMO_FLASHCARDS)
    s.quiz = copy.deepcopy(DEMO_QUIZ)
    s.quiz_id += 1
    s.quiz_submitted = False
    s.summary_source = "demo"
    s.quiz_source = "demo"


def reset_workspace():
    """Callback: clear notes, outputs and quiz state (the calculator is left untouched)."""
    s = st.session_state
    cleanup_quiz_widget_keys()
    s.notes_input = ""
    s.active_notes = ""
    s.uploader_key += 1
    s.summary = ""
    s.flashcards = []
    s.summary_source = None
    s.quiz = []
    s.quiz_id += 1
    s.quiz_submitted = False
    s.quiz_source = None


# ---------------------------------------------------------------------------
# Floating calculator (logic)
# ---------------------------------------------------------------------------
_BIN_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}
_UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def safe_eval(expression):
    """Evaluate + - * / and parentheses using the AST (never eval())."""
    # Python rejects literals like "05", so strip redundant leading zeros first.
    cleaned = re.sub(r"(?<![\d.])0+(?=\d)", "", expression)
    tree = ast.parse(cleaned, mode="eval")

    def _eval(node):
        if isinstance(node, ast.Expression):
            return _eval(node.body)
        if (
            isinstance(node, ast.Constant)
            and isinstance(node.value, (int, float))
            and not isinstance(node.value, bool)
        ):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _BIN_OPS:
            return _BIN_OPS[type(node.op)](_eval(node.left), _eval(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPS:
            return _UNARY_OPS[type(node.op)](_eval(node.operand))
        raise ValueError("Unsupported expression")

    result = _eval(tree)
    if isinstance(result, float) and not math.isfinite(result):
        raise OverflowError("Result out of range")
    return result


def format_number(value):
    if isinstance(value, int):
        return str(value)
    if value.is_integer() and abs(value) < 1e15:
        return str(int(value))
    return f"{value:.10g}"


def pretty_expr(expression):
    return expression.replace("*", "×").replace("/", "÷").replace("-", "−")


def calc_press(token):
    """Callback for every calculator key."""
    s = st.session_state
    s.calc_msg = ""
    operators = {"+", "-", "*", "/"}
    starts_new = set("0123456789.(")

    if token == "C":
        s.calc_expr = ""
        s.calc_last = ""
        s.calc_fresh = False
    elif token == "BACK":
        s.calc_expr = s.calc_expr[:-1]
        s.calc_fresh = False
    elif token == "=":
        if not s.calc_expr:
            return
        try:
            result = format_number(safe_eval(s.calc_expr))
            equation = f"{pretty_expr(s.calc_expr)} = {result}"
            s.calc_history = (s.calc_history + [equation])[-5:]
            s.calc_last = f"{pretty_expr(s.calc_expr)} ="
            s.calc_expr = result
            s.calc_fresh = True
        except ZeroDivisionError:
            s.calc_msg = "Error: division by zero"
            s.calc_expr = ""
            s.calc_last = ""
            s.calc_fresh = False
        except (SyntaxError, ValueError, TypeError, OverflowError):
            s.calc_msg = "Invalid expression"
            s.calc_expr = ""
            s.calc_last = ""
            s.calc_fresh = False
    else:
        if s.calc_fresh and token in starts_new:
            s.calc_expr = ""  # typing a number after "=" starts a new calculation
        s.calc_fresh = False
        if token in operators:
            if not s.calc_expr:
                if token == "-":
                    s.calc_expr = "-"
                return
            if s.calc_expr[-1] in operators:
                s.calc_expr = s.calc_expr[:-1] + token  # swap the previous operator
                return
        s.calc_expr += token


def toggle_calculator():
    st.session_state.calc_open = not st.session_state.calc_open


# (button label, token sent to calc_press, widget-key suffix)
KEYPAD = [
    [("C", "C", "btn_clear"), ("⌫", "BACK", "fn_back"), ("(", "(", "fn_lp"), (")", ")", "fn_rp")],
    [("7", "7", "num_7"), ("8", "8", "num_8"), ("9", "9", "num_9"), ("÷", "/", "op_div")],
    [("4", "4", "num_4"), ("5", "5", "num_5"), ("6", "6", "num_6"), ("×", "*", "op_mul")],
    [("1", "1", "num_1"), ("2", "2", "num_2"), ("3", "3", "num_3"), ("−", "-", "op_sub")],
    [("0", "0", "num_0"), (".", ".", "num_dot"), ("=", "=", "btn_eq"), ("+", "+", "op_add")],
]


def keyed_container(key):
    """st.container(key=...) exposes a `.st-key-<key>` CSS class (Streamlit 1.39+)."""
    try:
        return st.container(key=key)
    except TypeError:
        return st.container()


def render_calculator():
    s = st.session_state

    with keyed_container("calc_toggle"):
        label = "✕ Close Calculator" if s.calc_open else "🧮 Open Calculator"
        st.button(label, key="calc_toggle_btn", on_click=toggle_calculator)

    if not s.calc_open:
        return

    with keyed_container("calc_panel"):
        st.markdown('<div class="calc-title">🧮 Scratchpad calculator</div>', unsafe_allow_html=True)

        current = html.escape(pretty_expr(s.calc_expr)) or "0"
        last_class = "calc-last err" if s.calc_msg else "calc-last"
        last_text = html.escape(s.calc_msg or s.calc_last)
        st.markdown(
            f'<div class="calc-display"><div class="{last_class}">{last_text}&nbsp;</div>'
            f'<div class="calc-current">{current}</div></div>',
            unsafe_allow_html=True,
        )

        for row in KEYPAD:
            columns = st.columns(4)
            for column, (label, token, kind) in zip(columns, row):
                with column:
                    st.button(label, key=f"calc_{kind}", on_click=calc_press, args=(token,))

        if s.calc_history:
            recent = [html.escape(item) for item in reversed(s.calc_history[-3:])]
            history_html = "<br>".join(recent)
            st.markdown(f'<div class="calc-history">{history_html}</div>', unsafe_allow_html=True)


# ---------------------------------------------------------------------------
# LLM layer
# ---------------------------------------------------------------------------
class MissingAPIKeyError(Exception):
    """Raised when an AI action is requested without an API key."""


def _call_openai(api_key, model, system_prompt, user_prompt):
    if OpenAI is None:
        raise RuntimeError("The `openai` package is not installed. Run: pip install openai")
    client = OpenAI(api_key=api_key)
    kwargs = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {"type": "json_object"},
    }
    try:
        response = client.chat.completions.create(temperature=0.3, **kwargs)
    except Exception as exc:
        # Some newer models only accept the default temperature; retry without it.
        if "temperature" in str(exc).lower():
            response = client.chat.completions.create(**kwargs)
        else:
            raise
    content = response.choices[0].message.content
    if not content:
        raise ValueError("The model returned an empty response.")
    return content


def _call_gemini(api_key, model, system_prompt, user_prompt):
    if genai is None:
        raise RuntimeError(
            "The `google-generativeai` package is not installed. Run: pip install google-generativeai"
        )
    genai.configure(api_key=api_key)
    model_client = genai.GenerativeModel(model_name=model, system_instruction=system_prompt)
    response = model_client.generate_content(
        user_prompt,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0.3,
        ),
    )
    text = response.text
    if not text:
        raise ValueError("The model returned an empty response.")
    return text


def call_llm(cfg, system_prompt, user_prompt):
    if not cfg["api_key"]:
        raise MissingAPIKeyError("No API key supplied.")
    if cfg["provider"] == "OpenAI":
        return _call_openai(cfg["api_key"], cfg["model"], system_prompt, user_prompt)
    return _call_gemini(cfg["api_key"], cfg["model"], system_prompt, user_prompt)


def parse_json_response(raw):
    """Parse model output as JSON, tolerating code fences or stray prose around it."""
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        starts = [i for i in (cleaned.find("{"), cleaned.find("[")) if i != -1]
        end = max(cleaned.rfind("}"), cleaned.rfind("]"))
        if not starts or end == -1:
            raise
        return json.loads(cleaned[min(starts) : end + 1])


def normalize_summary_payload(payload):
    """Validate the summary/flashcards JSON and return (summary_markdown, flashcards)."""
    if not isinstance(payload, dict):
        raise ValueError("expected a JSON object with 'summary' and 'flashcards'")

    raw_summary = payload.get("summary") or payload.get("executive_summary")
    if isinstance(raw_summary, list):
        bullets = []
        for item in raw_summary:
            text = re.sub(r"^[-*•]\s*", "", str(item).strip())
            if text:
                bullets.append(f"- {text}")
        summary = "\n".join(bullets)
    else:
        summary = str(raw_summary or "").strip()

    cards = []
    for item in payload.get("flashcards") or []:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or item.get("front") or "").strip()
        answer = str(item.get("answer") or item.get("back") or "").strip()
        if question and answer:
            cards.append({"question": question, "answer": answer})
    cards = cards[:10]

    if not summary or not cards:
        raise ValueError("the response was missing a summary or flashcards")
    return summary, cards


def _clean_option_text(text):
    return re.sub(r"^\(?[A-Da-d][\)\.\:]\s*", "", str(text).strip())


def _normalize_letter(raw, options):
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    upper = text.upper()
    if upper in LETTERS:
        return upper
    for letter, option_text in options.items():  # the model returned the answer text itself
        if option_text.strip().lower() == text.lower():
            return letter
    match = re.match(r"^\(?([A-D])\b", upper)
    return match.group(1) if match else None


def normalize_quiz_payload(payload):
    """Validate MCQ JSON and return a clean list of question dicts."""
    if isinstance(payload, dict):
        items = payload.get("questions") or payload.get("quiz") or []
    elif isinstance(payload, list):
        items = payload
    else:
        raise ValueError("expected a JSON object with a 'questions' list")

    quiz = []
    for item in items:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question") or "").strip()
        raw_options = item.get("options")

        options = {}
        if isinstance(raw_options, dict):
            for key, value in raw_options.items():
                letter = str(key).strip().upper()[:1]
                if letter in LETTERS:
                    options[letter] = _clean_option_text(value)
        elif isinstance(raw_options, list) and len(raw_options) == 4:
            options = {letter: _clean_option_text(v) for letter, v in zip(LETTERS, raw_options)}

        if not question or sorted(options) != LETTERS or not all(options.values()):
            continue

        raw_correct = item.get("correct_answer") or item.get("correct") or item.get("answer")
        correct = _normalize_letter(raw_correct, options)
        if correct not in LETTERS:
            continue

        explanation = str(item.get("explanation") or "No explanation provided.").strip()
        quiz.append(
            {"question": question, "options": options, "correct": correct, "explanation": explanation}
        )

    quiz = quiz[:10]
    if not quiz:
        raise ValueError("no valid multiple-choice questions were found in the response")
    return quiz


def prepare_notes(notes):
    notes = notes.strip()
    if len(notes) > MAX_NOTE_CHARS:
        return notes[:MAX_NOTE_CHARS], True
    return notes, False


def build_summary_prompt(notes):
    return (
        "Analyze the following study notes and produce the JSON object described in your "
        f"instructions.\n\n<notes>\n{notes}\n</notes>"
    )


def build_quiz_prompt(notes, n):
    return (
        f"Write exactly {n} multiple-choice questions based on the following study notes, "
        f"following the JSON schema in your instructions.\n\n<notes>\n{notes}\n</notes>"
    )


# ---------------------------------------------------------------------------
# AI actions (with defensive error handling)
# ---------------------------------------------------------------------------
def process_notes(cfg, notes):
    try:
        if not cfg["api_key"]:
            raise MissingAPIKeyError(NO_KEY_MESSAGE)
        if not notes.strip():
            st.warning("Paste some notes or upload a file first, then click Process Notes.")
            return
        text, truncated = prepare_notes(notes)
        if truncated:
            st.warning(f"Your notes are long, so only the first {MAX_NOTE_CHARS:,} characters were analyzed.")
        with st.spinner("Reading your notes and building study material..."):
            raw = call_llm(cfg, SUMMARY_SYSTEM_PROMPT, build_summary_prompt(text))
            payload = parse_json_response(raw)
            summary, cards = normalize_summary_payload(payload)
        st.session_state.summary = summary
        st.session_state.flashcards = cards
        st.session_state.summary_source = "ai"
        st.success("Done! Your summary and flashcards are ready below.")
    except MissingAPIKeyError:
        st.info(NO_KEY_MESSAGE)
    except ValueError as exc:  # also covers json.JSONDecodeError
        st.error(
            f"The AI reply could not be read ({exc}). Try again, or pick a higher model tier in the sidebar."
        )
    except Exception as exc:
        st.error(f"The request to {cfg['provider']} failed: {exc}")


def generate_quiz(cfg, notes, n_questions):
    try:
        if not cfg["api_key"]:
            raise MissingAPIKeyError(NO_KEY_MESSAGE)
        if not notes.strip():
            st.warning("Add notes in the first tab (paste text or upload a file) before generating a test.")
            return
        text, truncated = prepare_notes(notes)
        if truncated:
            st.warning(f"Your notes are long, so only the first {MAX_NOTE_CHARS:,} characters were used.")
        system_prompt = QUIZ_SYSTEM_PROMPT_TEMPLATE.format(n=n_questions)
        with st.spinner("Writing your practice test..."):
            raw = call_llm(cfg, system_prompt, build_quiz_prompt(text, n_questions))
            payload = parse_json_response(raw)
            quiz = normalize_quiz_payload(payload)
        cleanup_quiz_widget_keys()
        st.session_state.quiz = quiz
        st.session_state.quiz_id += 1
        st.session_state.quiz_submitted = False
        st.session_state.quiz_source = "ai"
        st.success(f"Your {len(quiz)}-question practice test is ready.")
    except MissingAPIKeyError:
        st.info(NO_KEY_MESSAGE)
    except ValueError as exc:  # also covers json.JSONDecodeError
        st.error(
            f"The AI reply could not be read ({exc}). Try again, or pick a higher model tier in the sidebar."
        )
    except Exception as exc:
        st.error(f"The request to {cfg['provider']} failed: {exc}")


# ---------------------------------------------------------------------------
# Sidebar
# ---------------------------------------------------------------------------
def render_sidebar():
    with st.sidebar:
        st.header("⚙️ Workspace setup")

        provider = st.selectbox("AI provider", list(MODEL_TIERS.keys()))
        api_key = st.text_input(
            f"{provider} API key",
            type="password",
            key=f"api_key_{provider}",
            placeholder="Paste your key here",
            help="Held in this browser session's memory only. It is never written to disk by this app.",
        )
        tier = st.selectbox(
            "Study model tier",
            list(MODEL_TIERS[provider].keys()),
            index=1,
            key=f"tier_{provider}",
        )
        model = MODEL_TIERS[provider][tier]

        with st.expander("Advanced: custom model ID"):
            custom_model = st.text_input(
                "Override model ID",
                key=f"custom_model_{provider}",
                placeholder=model,
                help="Leave blank to use the model that matches the selected tier.",
            )
        if custom_model.strip():
            model = custom_model.strip()
        st.caption(f"Active model: `{model}`")

        if not api_key.strip():
            st.caption("No key yet? Load the demo below to try every feature.")

        st.divider()
        st.subheader("🧪 Demo mode")
        st.caption("Loads hardcoded engineering notes, a summary, flashcards and a 3-question math quiz. No API call is made.")
        st.button("Simulate Demo Notes", on_click=load_demo_data, type="primary")
        st.button("Reset workspace", on_click=reset_workspace)

        st.divider()
        st.caption("🧮 The floating calculator sits in the bottom-right corner of every tab.")

    return {"provider": provider, "api_key": api_key.strip(), "model": model}


# ---------------------------------------------------------------------------
# Tab 1: Note Summarizer & Flashcards
# ---------------------------------------------------------------------------
def combine_notes(pasted_text, uploaded_file):
    parts = []
    if uploaded_file is not None:
        try:
            parts.append(uploaded_file.getvalue().decode("utf-8", errors="replace"))
        except Exception as exc:
            st.error(f"Could not read the uploaded file: {exc}")
    if pasted_text and pasted_text.strip():
        parts.append(pasted_text)
    return "\n\n".join(part.strip() for part in parts if part.strip())


def build_export_markdown(summary, flashcards):
    lines = ["# Study Notes Export", "", "## Executive Summary", "", summary, "", "## Flashcards", ""]
    for number, card in enumerate(flashcards, start=1):
        lines.append(f"{number}. **Question:** {card['question']}")
        lines.append(f"   **Answer:** {card['answer']}")
        lines.append("")
    return "\n".join(lines)


def render_summary_tab(cfg):
    st.subheader("📝 Your notes")
    st.text_area(
        "Paste raw notes or a transcript",
        key="notes_input",
        height=260,
        placeholder="Paste lecture notes, a meeting transcript or a textbook section here...",
    )
    uploaded = st.file_uploader(
        "Or upload a plain text or Markdown file",
        type=["txt", "md", "markdown"],
        key=f"notes_file_{st.session_state.uploader_key}",
        help="If you provide both a file and pasted text, they are combined.",
    )

    notes_text = combine_notes(st.session_state.notes_input, uploaded)
    st.session_state.active_notes = notes_text  # reused by the quiz tab

    left, right = st.columns([1, 3])
    with left:
        process_clicked = st.button("Process Notes", type="primary")
    with right:
        st.caption(f"{len(notes_text):,} characters of notes ready")

    if process_clicked:
        process_notes(cfg, notes_text)

    if st.session_state.summary_source == "demo":
        st.info("🧪 Demo mode: you are viewing hardcoded mock engineering data. No API call was made.")

    if st.session_state.summary:
        st.markdown("### 📌 Executive summary")
        st.markdown(st.session_state.summary)

    if st.session_state.flashcards:
        st.markdown("### 🗂️ Flashcards")
        st.caption("Try to answer from memory first, then open the card to check yourself.")
        for card in st.session_state.flashcards:
            with st.expander(f"Question: {card['question']}"):
                st.markdown(f"**Answer:** {card['answer']}")

        st.download_button(
            "Download summary and flashcards (.md)",
            data=build_export_markdown(st.session_state.summary, st.session_state.flashcards),
            file_name="study_notes_export.md",
            mime="text/markdown",
        )

    if not st.session_state.summary and not st.session_state.flashcards:
        st.caption("Your summary and flashcards will appear here after you click Process Notes.")


# ---------------------------------------------------------------------------
# Tab 2: Interactive MCQ Practice Quiz
# ---------------------------------------------------------------------------
def submit_quiz():
    st.session_state.quiz_submitted = True


def retake_quiz():
    cleanup_quiz_widget_keys()
    st.session_state.quiz_id += 1
    st.session_state.quiz_submitted = False


def answer_key(index):
    return f"quizans_{st.session_state.quiz_id}_{index}"


def compute_score():
    score, unanswered = 0, 0
    for index, question in enumerate(st.session_state.quiz):
        chosen = st.session_state.get(answer_key(index))
        if chosen is None:
            unanswered += 1
        elif chosen == question["correct"]:
            score += 1
    return score, unanswered


def render_feedback(question, chosen):
    correct = question["correct"]
    correct_text = html.escape(question["options"][correct])

    if chosen == correct:
        st.markdown(
            f'<div class="fb fb-correct">✅ <b>Correct!</b> {correct}) {correct_text}</div>',
            unsafe_allow_html=True,
        )
    elif chosen is None:
        st.markdown(
            '<div class="fb fb-skipped">⚠️ <b>Not answered.</b> '
            f"The correct answer is {correct}) {correct_text}</div>",
            unsafe_allow_html=True,
        )
    else:
        chosen_text = html.escape(question["options"][chosen])
        st.markdown(
            f'<div class="fb fb-wrong">❌ <b>Your answer:</b> {chosen}) {chosen_text}</div>'
            f'<div class="fb fb-correct">✅ <b>Correct answer:</b> {correct}) {correct_text}</div>',
            unsafe_allow_html=True,
        )
    st.info(f"🧠 **Step-by-step logic:** {question['explanation']}")


def render_quiz():
    quiz = st.session_state.quiz
    if not quiz:
        st.caption("Your quiz will appear here once you click Generate Practice Test.")
        return

    submitted = st.session_state.quiz_submitted

    if submitted:
        score, unanswered = compute_score()
        total = len(quiz)
        metric_col, bar_col = st.columns([1, 3])
        with metric_col:
            st.metric("Your score", f"{score} / {total}")
        with bar_col:
            st.progress(score / total)
            if score == total:
                st.success("Perfect score! 🎉")
            elif score / total >= 0.6:
                st.info("Solid work. Review the red answers below to close the gaps.")
            else:
                st.warning("Keep going. Read each explanation below, then retake the quiz.")
            if unanswered:
                st.caption(f"{unanswered} unanswered question(s) were counted as incorrect.")
        st.divider()

    for index, question in enumerate(quiz):
        st.markdown(f"**Q{index + 1}.** {question['question']}")
        st.radio(
            f"Question {index + 1}",
            options=LETTERS,
            format_func=lambda letter, q=question: f"{letter}) {q['options'][letter]}",
            index=None,
            key=answer_key(index),
            disabled=submitted,
            label_visibility="collapsed",
        )
        if submitted:
            render_feedback(question, st.session_state.get(answer_key(index)))
        st.divider()

    if submitted:
        st.button("Retake quiz", on_click=retake_quiz, type="primary")
    else:
        st.button("Submit Answers", on_click=submit_quiz, type="primary")


def render_quiz_tab(cfg):
    st.subheader("🎯 Interactive MCQ practice quiz")
    st.write("The quiz is built from the notes in the first tab, whether pasted or uploaded.")

    notes_len = len(st.session_state.active_notes)
    st.caption(f"{notes_len:,} characters of notes available")

    n_questions = st.slider("Number of questions", min_value=5, max_value=10, value=5, key="num_questions")
    if st.button("Generate Practice Test", type="primary"):
        generate_quiz(cfg, st.session_state.active_notes, n_questions)

    if st.session_state.quiz_source == "demo":
        st.info("🧪 Demo mode: this is a hardcoded 3-question math quiz. No API call was made. Use the calculator if you need it!")

    render_quiz()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    inject_css()
    init_state()
    cfg = render_sidebar()
    render_calculator()

    st.title("🧠 AI Note-Summarizer & Quiz Generator")
    st.caption("Turn messy notes into a clear summary, flashcards and a graded practice test.")

    tab_notes, tab_quiz = st.tabs(["Note Summarizer & Flashcards", "Interactive MCQ Practice Quiz"])
    with tab_notes:
        render_summary_tab(cfg)
    with tab_quiz:
        render_quiz_tab(cfg)


if __name__ == "__main__":
    main()