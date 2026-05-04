import time, json, os, uuid

class EventManager:
    def __init__(self):
        self.start_time = time.time()
        self.events = []
        self.session_id = str(uuid.uuid4())
        self.session_dir = f"data/{self.session_id}"
        os.makedirs(self.session_dir, exist_ok=True)

    def add_event(self, source, type_, data):
        t = round(time.time() - self.start_time, 3)
        self.events.append({
            "time": t,
            "source": source,
            "type": type_,
            "data": data
        })

    def save(self):
        path = f"{self.session_dir}/events.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.events, f, indent=2)
        return self.session_dir