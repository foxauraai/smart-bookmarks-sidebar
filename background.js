// background.js for Smart Bookmarks Sidebar (Firefox MV2)

const browserAPI = typeof browser !== "undefined" ? browser : chrome;

// Toggle sidebar when the toolbar button (browser_action) is clicked
browserAPI.browserAction.onClicked.addListener(() => {
  browserAPI.sidebarAction.toggle();
});

console.log("Smart Bookmarks Sidebar background script loaded.");
