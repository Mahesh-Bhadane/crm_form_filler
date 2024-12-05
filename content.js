let isMapping = false;
let isRecording = false;
let crmFields = [];
let currentCrmField = null;

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  console.log("Message received in content script:", request);
  if (request.action === "startRecording") {
    isRecording = true;
    startRecording();
  } else if (request.action === "stopRecording") {
    isRecording = false;
    stopRecording();
  } else if (request.action === "runConfiguration") {
    runConfiguration(request.configuration);
  } else if (request.action === "scanPageInputs") {
    console.log("Scanning page inputs");
    const inputs = [];

    document.querySelectorAll("input, select, textarea").forEach((element) => {
      let identifier = "";

      // Get the most specific identifier available
      if (element.id) {
        identifier = `#${element.id}`;
      } else if (element.className) {
        identifier = `.${element.className.split(" ").join(".")}`;
      }

      if (identifier) {
        inputs.push({
          type: element.tagName.toLowerCase(),
          identifier: identifier,
          inputType: element.type || "text",
          value: element.value || "",
        });
      }
    });

    console.log("Found inputs:", inputs);
    sendResponse({ inputs: inputs });
    return true;
  } else if (request.action === "ping") {
    sendResponse({ status: "ready" });
    return true;
  } else if (request.action === "highlightElement") {
    const element = findElementByIdentifier(request.identifier);
    if (element) {
      // Remove any existing highlights
      removeAllHighlights();
      // Add highlight to the element
      highlightElement(element);
    }
    return true;
  } else if (request.action === "getInputFields") {
    const inputs = [];
    document.querySelectorAll("input, select, textarea").forEach((element) => {
      let identifier = "";
      if (element.id) {
        identifier = `#${element.id}`;
      } else if (element.className) {
        identifier = `.${element.className.split(" ").join(".")}`;
      }
      if (identifier) {
        inputs.push({
          type: element.tagName.toLowerCase(),
          identifier: identifier,
          inputType: element.type || "text",
          value: element.value || "",
        });
      }
    });
    sendResponse({ inputs: inputs });
    return true;
  }
  return true;
});

function highlightNextField() {
  removeHighlight();
  showTooltip(`Click on the field for ${currentCrmField}`);
}

function showTooltip(message) {
  let tooltip = document.getElementById("crm-mapping-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "crm-mapping-tooltip";
    tooltip.style.position = "fixed";
    tooltip.style.top = "10px";
    tooltip.style.right = "10px";
    tooltip.style.backgroundColor = "yellow";
    tooltip.style.padding = "10px";
    tooltip.style.zIndex = "10000";
    document.body.appendChild(tooltip);
  }
  tooltip.textContent = message;
  tooltip.style.display = "block";
}

document.addEventListener("mouseover", function (e) {
  if (isMapping) {
    e.target.style.outline = "2px solid red";
  }
});

document.addEventListener("mouseout", function (e) {
  if (isMapping) {
    e.target.style.outline = "";
  }
});

document.addEventListener("click", function (e) {
  if (isMapping) {
    e.preventDefault();
    e.stopPropagation();
    const selector = generateSelector(e.target);
    chrome.runtime.sendMessage({
      action: "fieldMapped",
      crmField: currentCrmField,
      selector: selector,
    });
    const currentIndex = crmFields.indexOf(currentCrmField);
    if (currentIndex < crmFields.length - 1) {
      currentCrmField = crmFields[currentIndex + 1];
      highlightNextField();
    } else {
      isMapping = false;
      removeHighlight();
    }
  }
});

function generateSelector(element) {
  if (element.id) {
    return "#" + element.id;
  } else if (element.name) {
    return '[name="' + element.name + '"]';
  } else {
    let path = [];
    while (element.nodeType === Node.ELEMENT_NODE) {
      let selector = element.nodeName.toLowerCase();
      if (element.className) {
        selector += "." + element.className.replace(/\s+/g, ".");
      }
      path.unshift(selector);
      element = element.parentNode;
    }
    return path.join(" > ");
  }
}

function removeHighlight() {
  const tooltip = document.getElementById("crm-mapping-tooltip");
  if (tooltip) {
    tooltip.style.display = "none";
  }
  document.querySelectorAll("*").forEach((el) => {
    el.style.outline = "";
  });
}

function startRecording() {
  document.addEventListener("change", recordChange);
  document.addEventListener("click", recordClick);
  document.addEventListener("input", recordInput);
  document.addEventListener("select", recordSelect);
}

function stopRecording() {
  document.removeEventListener("change", recordChange);
  document.removeEventListener("click", recordClick);
  document.removeEventListener("input", recordInput);
  document.removeEventListener("select", recordSelect);
}

function recordChange(e) {
  if (isRecording) {
    const target = e.target;
    let step;

    if (target.type === "checkbox") {
      step = {
        action: "checkbox",
        selector: generateSelector(target),
        checked: target.checked,
      };
    } else if (target.type === "radio") {
      step = {
        action: "radio",
        selector: generateSelector(target),
        value: target.value,
      };
    } else if (target.tagName === "SELECT") {
      step = {
        action: "select",
        selector: generateSelector(target),
        value: target.value,
      };
    } else {
      step = {
        action: "change",
        selector: generateSelector(target),
        value: target.value,
      };
    }

    chrome.runtime.sendMessage({ action: "stepRecorded", step: step });
    console.log("Step recorded:", step); // Add this line for debugging
  }
}

function recordClick(e) {
  if (isRecording) {
    const target = e.target;
    if (
      target.tagName === "BUTTON" ||
      target.tagName === "A" ||
      target.type === "submit"
    ) {
      const step = {
        action: "click",
        selector: generateSelector(target),
      };
      chrome.runtime.sendMessage({ action: "stepRecorded", step: step });
    }
  }
}

function recordInput(e) {
  if (isRecording) {
    const target = e.target;
    if (
      target.tagName === "INPUT" &&
      (target.type === "text" ||
        target.type === "number" ||
        target.type === "email")
    ) {
      const step = {
        action: "input",
        selector: generateSelector(target),
        value: target.value,
      };
      chrome.runtime.sendMessage({ action: "stepRecorded", step: step });
    }
  }
}

function recordSelect(e) {
  if (isRecording) {
    const target = e.target;
    if (target.tagName === "SELECT") {
      const step = {
        action: "select",
        selector: generateSelector(target),
        value: target.value,
      };
      chrome.runtime.sendMessage({ action: "stepRecorded", step: step });
    }
  }
}

function runConfiguration(configuration) {
  console.log("Running configuration:", configuration); // Add this line for debugging
  for (const [crmField, selector] of Object.entries(configuration.mapping)) {
    const element = document.querySelector(selector);
    if (element) {
      element.value = "CRM_VALUE_FOR_" + crmField; // Replace with actual CRM value
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  configuration.steps.forEach((step) => {
    console.log("Executing step:", step); // Add this line for debugging
    const element = document.querySelector(step.selector);
    if (element) {
      switch (step.action) {
        case "change":
        case "input":
          element.value = step.value;
          element.dispatchEvent(new Event("change", { bubbles: true }));
          element.dispatchEvent(new Event("input", { bubbles: true }));
          break;
        case "click":
          element.click();
          break;
        case "checkbox":
          element.checked = step.checked;
          element.dispatchEvent(new Event("change", { bubbles: true }));
          break;
        case "radio":
          element.checked = true;
          element.dispatchEvent(new Event("change", { bubbles: true }));
          break;
        case "select":
          element.value = step.value;
          element.dispatchEvent(new Event("change", { bubbles: true }));
          break;
      }
    } else {
      console.log("Element not found for selector:", step.selector); // Add this line for debugging
    }
  });
}

// Comment out or remove this line
// if (elements.showMappings) elements.showMappings.addEventListener('click', showCurrentMappings);

function showCurrentMappings() {
  console.log("Current mapping:", currentMapping);
  showFeedback("Current mapping logged to console", elements);
}

function findLabel(element) {
  // Try to find a label for the input
  let label = "";

  // Check for label element
  if (element.id) {
    const labelElement = document.querySelector(`label[for="${element.id}"]`);
    if (labelElement) {
      label = labelElement.textContent.trim();
    }
  }

  // Check for aria-label
  if (!label && element.getAttribute("aria-label")) {
    label = element.getAttribute("aria-label");
  }

  // Check for placeholder
  if (!label && element.placeholder) {
    label = element.placeholder;
  }

  // If no label found, use identifier
  if (!label) {
    if (element.id) {
      label = `#${element.id}`;
    } else if (element.name) {
      label = `[name="${element.name}"]`;
    } else if (element.className) {
      label = `.${element.className.split(" ").join(".")}`;
    }
  }

  return label;
}

function ensureContentScriptLoaded(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) {
      showFeedback("No active tab found");
      return;
    }

    chrome.tabs.sendMessage(
      tabs[0].id,
      { action: "ping" },
      function (response) {
        if (chrome.runtime.lastError) {
          // Content script not loaded, reload the tab
          chrome.tabs.reload(tabs[0].id, {}, function () {
            setTimeout(callback, 1000); // Wait for reload
          });
        } else {
          callback();
        }
      }
    );
  });
}

console.log("Content script loaded");

function findElementByIdentifier(identifier) {
  // Remove the '#' if present
  identifier = identifier.replace("#", "");
  return document.querySelector(`[id="${identifier}"], [name="${identifier}"]`);
}

function removeAllHighlights() {
  const highlighted = document.querySelectorAll(".extension-highlight");
  highlighted.forEach((el) => {
    el.classList.remove("extension-highlight");
    el.style.removeProperty("outline");
    el.style.removeProperty("outline-offset");
  });
}

function highlightElement(element) {
  element.classList.add("extension-highlight");
  element.style.outline = "2px solid #007bff";
  element.style.outlineOffset = "2px";

  // Optional: Remove highlight after 2 seconds
  setTimeout(() => {
    element.classList.remove("extension-highlight");
    element.style.removeProperty("outline");
    element.style.removeProperty("outline-offset");
  }, 2000);
}

// Add these CSS styles to handle input highlighting
const style = document.createElement("style");
style.textContent = `
    .recording-highlight:hover {
        outline: 2px solid red !important;
        cursor: pointer !important;
    }
`;
document.head.appendChild(style);

// Update the keybind recording listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startRecordingKeybind") {
    // Add recording class to body to enable hover effects
    document.body.classList.add("recording-mode");

    // Add hover effect to all input elements
    const inputs = document.querySelectorAll("input");
    inputs.forEach((input) => {
      input.classList.add("recording-highlight");
    });

    // Add one-time click listener to document
    const clickHandler = function (e) {
      if (e.target.tagName === "INPUT") {
        let identifier =
          e.target.id ||
          e.target.name ||
          `input-${Array.from(document.querySelectorAll("input")).indexOf(
            e.target
          )}`;

        // Remove recording highlights from all inputs
        document.querySelectorAll(".recording-highlight").forEach((el) => {
          el.classList.remove("recording-highlight");
        });
        document.body.classList.remove("recording-mode");

        // Send the identifier back to the extension
        chrome.runtime.sendMessage({
          action: "keybindRecorded",
          identifier: "#" + identifier,
        });

        // Remove the click listener
        document.removeEventListener("click", clickHandler);
      }
    };

    document.addEventListener("click", clickHandler);
    sendResponse({ success: true });
    return true;
  }
});

console.log("Content script loaded");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Received message:", request);
  if (request.action === "highlightElement") {
    console.log("Highlighting element with identifier:", request.identifier);
    const element = document.getElementById(request.identifier);
    if (element) {
      console.log("Element found:", element);
      element.style.border = "2px solid red"; 
      sendResponse({ success: true });
      setTimeout(() => {
        element.style.border = ""; 
      }, 3000);
    } else {
      console.warn("Element not found for identifier:", request.identifier);
      sendResponse({ success: false, message: "Element not found" });
    }
  }
  if (request.action === "fillInputField") {
    const { identifier, value } = request;
    const inputField = document.getElementById(identifier);

    if (inputField) {
      inputField.value = value;
      inputField.dispatchEvent(new Event("input", { bubbles: true }));
      inputField.dispatchEvent(new Event("change", { bubbles: true }));
      console.log(
        `Filled input field with identifier: ${identifier}, value: ${value}`
      );
    } else {
      console.warn(`Input field not found for identifier: ${identifier}`);
    }
  }
});