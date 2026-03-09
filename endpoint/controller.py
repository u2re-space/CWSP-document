# controller.py
import json
import os
import sys

from dotenv import load_dotenv

try:
  from windows_use.llms.openai import ChatOpenAI
  from windows_use.agent import Agent, Browser
  WINDOWS_USE_AVAILABLE = True
except ImportError as err:
  WINDOWS_USE_AVAILABLE = False
  WINDOWS_USE_IMPORT_ERROR = str(err)

load_dotenv()


def emit(payload):
  sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
  sys.stdout.flush()


def iter_messages():
  for line in sys.stdin:
    line = line.strip()
    if not line:
      continue
    try:
      msg = json.loads(line)
    except json.JSONDecodeError:
      continue
    yield msg


def emit_windows_use_unavailable(command_text):
  emit({
    "type": "actions",
    "actions": [],
    "error": f"windows-use module unavailable: {WINDOWS_USE_IMPORT_ERROR}",
    "text": command_text,
  })


def main():
  if not WINDOWS_USE_AVAILABLE:
    for msg in iter_messages():
      if msg.get("type") == "voice_command":
        emit_windows_use_unavailable(msg.get("text", ""))
    return

  try:
    llm = ChatOpenAI(
      model='gpt-5.2',
      base_url=os.getenv("GPT_ENDPOINT"),
      api_key=os.getenv("GPT_API_KEY")
    )
    agent = Agent(llm=llm, browser=Browser.EDGE, use_vision=False, auto_minimize=False)
  except Exception as err:
    emit({
      "type": "error",
      "error": f"Failed to initialize windows-use agent: {err}"
    })
    return

  for msg in iter_messages():
    if msg.get("type") != "voice_command":
      continue

    text = msg.get("text", "")
    try:
      out = agent.invoke(query=text)
      emit(out)
    except Exception as err:
      emit({
        "type": "actions",
        "actions": [],
        "error": str(err),
        "text": text,
      })


if __name__ == "__main__":
  main()
