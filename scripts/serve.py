"""Local preview, including the /therapy-trainer/ prefix used on GitHub Pages."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/therapy-trainer":
            self.send_response(301)
            self.send_header("Location", "/therapy-trainer/")
            self.end_headers()
            return
        if path.startswith("/therapy-trainer/"):
            self.path = self.path[len("/therapy-trainer"):]
        if any(part.startswith(".") for part in urlsplit(self.path).path.split("/") if part):
            self.send_error(404)
            return
        super().do_GET()


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    server = ThreadingHTTPServer(("0.0.0.0", 4173), partial(Handler, directory=str(root)))
    print("Local: http://localhost:4173/therapy-trainer/", flush=True)
    server.serve_forever()
