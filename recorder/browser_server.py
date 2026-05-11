from flask import Flask, request
from flask_cors import CORS

# Campos que vienen del JS pero no deben quedar dentro de `data`.
# Los maneja event_manager (`time`) o ya está en el wrapper (`source`, `type`).
_META_FIELDS = ("source", "type", "time")


def create_app(manager):
    app = Flask(__name__)
    CORS(app)

    @app.route("/event", methods=["POST"])
    def receive_event():
        msg = request.json or {}
        event_type = msg.get("type")
        if not event_type:
            return {"status": "error", "reason": "missing type"}, 400

        payload = {k: v for k, v in msg.items() if k not in _META_FIELDS}
        manager.add_event("browser", event_type, payload)
        return {"status": "ok"}

    return app
