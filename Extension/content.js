function getXPath(element) {
  if (element.id) return `//*[@id="${element.id}"]`;
  if (element === document.body) return '/html/body';

  let ix = 0;
  const siblings = element.parentNode.childNodes;

  for (let i = 0; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling === element) {
      return getXPath(element.parentNode) + '/' + element.tagName + '[' + (ix + 1) + ']';
    }
    if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
      ix++;
    }
  }
}

// 🎯 CLICK
document.addEventListener("click", (e) => {
  const el = e.target;

  const data = {
    type: "click",
    tag: el.tagName,
    text: el.innerText?.slice(0, 100),
    id: el.id,
    classes: el.className,
    xpath: getXPath(el),
    url: window.location.href,
    time: Date.now()
  };

  chrome.runtime.sendMessage(data);
});

// ⌨️ INPUT
document.addEventListener("input", (e) => {
  const el = e.target;

  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const data = {
      type: "input",
      value: el.value,
      id: el.id,
      name: el.name,
      xpath: getXPath(el),
      url: window.location.href,
      time: Date.now()
    };

    chrome.runtime.sendMessage(data);
  }
});