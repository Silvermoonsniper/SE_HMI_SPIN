"""Thread-safe fan-out hub that forwards Spin backend updates to WebSocket clients.

The Spin backend publishes updates from its own asyncio loop (main thread),
while the FastAPI/uvicorn server and its WebSocket handlers run on a separate
loop inside a background thread. Publishing is therefore marshalled onto the
API loop with ``loop.call_soon_threadsafe``.
"""

import asyncio
import threading


class UpdateHub:
    """Fan out Spin update dicts to any number of asyncio queue subscribers."""

    def __init__(self):
        """Initialize empty subscriber storage with no bound API loop."""
        self._lock = threading.Lock()
        self._subscribers = set()
        self._loop = None

    def bind_loop(self, loop):
        """Remember the asyncio loop that runs the API server."""
        self._loop = loop

    def subscribe(self, maxsize=1000):
        """Create and register a new subscriber queue."""
        queue = asyncio.Queue(maxsize=maxsize)
        with self._lock:
            self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue):
        """Remove a subscriber queue."""
        with self._lock:
            self._subscribers.discard(queue)

    def publish(self, message):
        """Publish one update message from any thread or loop."""
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._dispatch, message)
        except RuntimeError:
            # API loop is shutting down; dropping updates is fine.
            pass

    def _dispatch(self, message):
        """Deliver the message to all subscribers on the API loop."""
        with self._lock:
            subscribers = list(self._subscribers)
        for queue in subscribers:
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # Drop the oldest item so slow clients never block the stream.
                try:
                    queue.get_nowait()
                    queue.put_nowait(message)
                except Exception:
                    pass


update_hub = UpdateHub()
