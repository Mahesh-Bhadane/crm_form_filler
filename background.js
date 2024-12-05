// Listen for messages from the popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startRecording") {
    // Start recording steps
  } else if (request.action === "stopRecording") {
    // Stop recording and save steps
  } else if (request.action === "executeSteps") {
    // Execute recorded steps
  } else if (request.action === "eraseSteps") {
    // Erase recorded steps for a website
  } else if (request.action === "getFieldMappings") {
    // Load and send field mappings
    fetch(chrome.runtime.getURL('field_mappings.json'))
      .then(response => response.json())
      .then(data => sendResponse({ fieldMappings: data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Indicates response will be sent asynchronously
  } else if (request.action === "saveSteps") {
    // Save the recorded steps, including field mappings
    saveRecordedSteps(sender.tab.url, request.steps);
  } else if (request.action === "submitFormId") {
    submitFormId(request.formId)
      .then(data => sendResponse({ success: true, data: data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Indicates response will be sent asynchronously
  } else if (request.action === "fetchFormData") {
    fetchFormData(request.formId)
      .then(data => sendResponse({ success: true, data: data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Indicates response will be sent asynchronously
  }
});

// Mock function to fetch CRM data (replace with actual API call)
// async function fetchCRMData(formId) {
//   return new Promise((resolve) => {
//     setTimeout(() => {
//       resolve({
//         name: "John Doe",
//         email: "john@example.com",
//         phone: "1234567890"
//       });
//     }, 1000);
//   });
// }

// Function to save recorded steps
function saveRecordedSteps(url, steps) {
  chrome.storage.sync.set({ [url]: steps }, () => {
    console.log('Steps saved for:', url);
  });
}

// Function to retrieve recorded steps
function getRecordedSteps(url, callback) {
  chrome.storage.sync.get(url, (result) => {
    callback(result[url]);
  });
}

// Function to fetch form data from CRM
async function submitFormId(formId) {
  const cookies = await chrome.cookies.getAll({ domain: "base.amberstudent.com" });
  const cookieHeader = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

  const response = await fetch(`http://localhost:3002/forms/${formId}`, {
    method: 'GET',
    headers: {
      'Cookie': cookieHeader,
      'Content-Type': 'application/json'
    },
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const responseData = await response.json();
  return responseData.data;
}

// Open side panel when the action icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
