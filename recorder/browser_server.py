from flask import Flask, request
from flask_cors import CORS

def create_app(manager):
    app = Flask(__name__)
    CORS(app)

    @app.route("/event", methods=["POST"])
    def receive_event():
        data = request.json
        manager.add_event("browser", data.get("type"), data)
        return {"status": "ok"}

    return app