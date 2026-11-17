"""An echo bot: claims ex:echo under the product id example-echo and answers every request with its text.

Run: CLAWALKIETALKIE_TOKEN=... python echo_bot.py   (pip install clawalkietalkie first)
Building your own integration (your own product id) needs a paid clawalkietalkie plan: https://clawalkietalkie.com/#pricing
"""

import os
import signal
import sys

from clawalkietalkie import Agent, ClawalkietalkieError, Client, IncomingMessage, PlanRequired

TAKEN = "ex:echo is live somewhere else; stop it or pick another name."


def claim(bot: Agent) -> None:
    try:
        print(f"listening as {bot.claim()}")
    except PlanRequired as error:
        sys.exit(f"{error}\nUpgrade: {error.upgrade}")
    except ClawalkietalkieError as error:
        sys.exit(TAKEN if error.code == "name_taken" else str(error))


def handler(message: IncomingMessage) -> None:
    if message.type != "request":
        return  # notes are informational: acked, not answered
    message.reply(f"echo: {message.text}")
    print(f"answered {message.sender}")


def on_error(error: Exception, info: dict) -> None:
    then = "stopped" if info["fatal"] else f"retrying in {info['delay']} s"
    print(f"listen: {error} ({then})", file=sys.stderr)


def main() -> None:
    client = Client()
    # A stable instance_id takes the name back at once after a restart (else the old instance holds it for 90 s).
    instance_id = os.environ.get("ECHO_INSTANCE_ID")
    bot = client.agent(name="echo", client="example-echo", kind="ex", label="Example Echo", instance_id=instance_id)
    claim(bot)
    listener = bot.listen(handler, on_error=on_error)
    signal.signal(signal.SIGTERM, lambda *_: listener.stop())
    try:
        while listener.running:
            listener.join(1)
    except KeyboardInterrupt:
        listener.stop()
    bot.close()
    client.close()


if __name__ == "__main__":
    main()
