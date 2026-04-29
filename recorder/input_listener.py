from pynput import mouse, keyboard

def start_listeners(manager):

    def on_click(x, y, button, pressed):
        if pressed:
            manager.add_event("system", "click", {
                "x": x, "y": y, "button": str(button)
            })

    def on_press(key):
        manager.add_event("system", "key", {
            "key": str(key)
        })

    mouse.Listener(on_click=on_click).start()
    keyboard.Listener(on_press=on_press).start()