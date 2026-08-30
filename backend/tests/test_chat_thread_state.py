"""Chat reply-bucket denormalized direction helper."""

from app.models import ChatThread
from app.services.chat_thread_state import touch_thread_on_message


def test_touch_thread_on_message_sets_direction():
    thread = ChatThread(provider="green_api")
    touch_thread_on_message(thread, "in")
    assert thread.last_message_direction == "in"
    touch_thread_on_message(thread, "out")
    assert thread.last_message_direction == "out"
    # garbage direction does not wipe previous
    prev = thread.last_message_direction
    touch_thread_on_message(thread, "sideways")
    assert thread.last_message_direction == prev
