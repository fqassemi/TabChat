chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "getText") {
    setTimeout(() => {
      // کمی صبر کن تا سایت‌های SPA کامل لود بشن
      const text = document.body.innerText.slice(0, 100000);
      sendResponse(text);
    }, 1500);
    return true;
  }
});
