chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "TIMOCOM_CARD_SELECTED") {
    chrome.storage.local.set({
      lastTimocomText: message.text
    });

    chrome.sidePanel.open({ windowId: sender.tab.windowId });
  }
});