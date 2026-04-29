chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  fetch("http://localhost:5000/event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message)
  })
  .then(res => res.json())
  .then(data => console.log("Enviado:", data))
  .catch(err => console.error("Error:", err));
});