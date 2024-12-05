let isRecording = false;
let currentScriptName = '';
let fetchedData = null;
let currentMapping = {};
let recordedSteps = [];
let crmFields = [];
let isMapping = false;
let currentMappingField = null;

document.addEventListener('DOMContentLoaded', function() {
  const elements = {
    fetchData: document.getElementById('fetchData'),
    startMapping: document.getElementById('startMapping'),
    stopMapping: document.getElementById('stopMapping'),
    saveMapping: document.getElementById('saveMapping'),
    saveConfiguration: document.getElementById('saveConfiguration'),
    runConfiguration: document.getElementById('runConfiguration'),
    deleteConfiguration: document.getElementById('deleteConfiguration'),
    mappingSection: document.getElementById('mappingSection'),
    fieldMappings: document.getElementById('fieldMappings'),
    feedback: document.getElementById('feedback'),
    mappingStatus: document.getElementById('mappingStatus')
  };

  // Check if all elements exist
  for (const [key, element] of Object.entries(elements)) {
    if (!element) {
      console.error(`Element '${key}' not found in the DOM`);
    }
  }

  if (elements.fetchData) elements.fetchData.addEventListener('click', () => fetchCRMData(elements));
  if (elements.startMapping) elements.startMapping.addEventListener('click', () => startMapping(elements));
  if (elements.stopMapping) elements.stopMapping.addEventListener('click', () => stopMapping(elements));
  if (elements.saveMapping) elements.saveMapping.addEventListener('click', () => saveMapping(elements));
  if (elements.saveConfiguration) elements.saveConfiguration.addEventListener('click', () => saveConfiguration(elements));
  if (elements.runConfiguration) elements.runConfiguration.addEventListener('click', () => runConfiguration(elements));
  if (elements.deleteConfiguration) elements.deleteConfiguration.addEventListener('click', () => deleteConfiguration(elements));

  loadConfigurations(elements);

  const createMappingButton = document.getElementById('createDefaultMapping');
  if (createMappingButton) {
    createMappingButton.addEventListener('click', function() {
      ensureContentScriptLoaded(createFieldMappings);
    });
  } else {
    console.error('Create Mapping button not found in popup');
  }
});

async function fetchFormData() {
  const formId = document.getElementById('formId').value;
  if (formId) {
    try {
      // First, try to fetch using the background script
      const response = await chrome.runtime.sendMessage({action: "fetchFormData", formId: formId});
      if (response.success) {
        fetchedData = response.data;
        displayFetchedFields(fetchedData);
        showFeedback("Form data fetched successfully");
      } else {
        // If that fails, try using the content script
        chrome.tabs.query({active: true, currentWindow: true}, async function(tabs) {
          const contentResponse = await chrome.tabs.sendMessage(tabs[0].id, {action: "fetchFormData", formId: formId});
          if (contentResponse.success) {
            fetchedData = contentResponse.data;
            displayFetchedFields(fetchedData);
            showFeedback("Form data fetched successfully (via content script)");
          } else {
            throw new Error(contentResponse.error);
          }
        });
      }
    } catch (error) {
      console.error('Error fetching form data:', error);
      showFeedback(`Error fetching form data: ${error.message}`);
    }
  }
}

function displayFetchedFields(data) {
  const fetchedFieldsDiv = document.getElementById('fetchedFields');
  fetchedFieldsDiv.innerHTML = '<h2>Fetched Fields:</h2>';
  fetchedFieldsDiv.style.display = 'block';

  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'object') {  // Only display simple fields
      const fieldDiv = document.createElement('div');
      fieldDiv.className = 'field-item';
      fieldDiv.innerHTML = `
        <label for="${key}">${key}:</label>
        <input type="text" id="${key}" value="${value}" readonly>
        <input type="checkbox" id="save_${key}">
        <label for="save_${key}">Save</label>
      `;
      fetchedFieldsDiv.appendChild(fieldDiv);
    }
  }
}

function toggleRecording() {
  isRecording = !isRecording;
  
  if (isRecording) {
    currentScriptName = prompt('Enter a name for this script:');
    if (!currentScriptName) {
      isRecording = false;
      return;
    }
    startRecording();
  } else {
    stopRecording();
  }

  updateUI();
}

function startRecording() {
  const fieldsToSave = getFieldsToSave();
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {
      action: "startRecording",
      fieldsToSave: fieldsToSave
    });
  });
}

function getFieldsToSave() {
  const fieldsToSave = {};
  document.querySelectorAll('#fetchedFields input[type="checkbox"]:checked').forEach(checkbox => {
    const fieldName = checkbox.id.replace('save_', '');
    fieldsToSave[fieldName] = fetchedData[fieldName];
  });
  return fieldsToSave;
}

function stopRecording() {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {action: "stopRecording"}, function(response) {
      if (response && response.steps) {
        saveScript(currentScriptName, response.steps);
      }
    });
  });
}

function saveScript(name, steps) {
  chrome.storage.local.get('savedScripts', function(data) {
    const savedScripts = data.savedScripts || {};
    savedScripts[name] = steps;
    chrome.storage.local.set({savedScripts: savedScripts}, function() {
      console.log('Script saved:', name);
      loadSavedScripts();
    });
  });
}

function executeSteps() {
  const formId = document.getElementById('formId').value;
  const scriptName = document.getElementById('savedScripts').value;
  
  if (!formId) {
    alert('Please enter a Form ID before executing steps.');
    return;
  }

  if (!scriptName) {
    alert('Please select a saved script to execute.');
    return;
  }

  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {
      action: "executeSteps",
      formId: formId,
      scriptName: scriptName
    });
  });
}

function eraseSteps() {
  const scriptName = document.getElementById('savedScripts').value;
  if (scriptName) {
    chrome.storage.local.get('savedScripts', function(data) {
      const savedScripts = data.savedScripts || {};
      delete savedScripts[scriptName];
      chrome.storage.local.set({savedScripts: savedScripts}, function() {
        console.log('Script erased:', scriptName);
        loadSavedScripts();
      });
    });
  }
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {action: "eraseSteps"});
  });
}

function updateUI() {
  const toggleRecordingButton = document.getElementById('toggleRecording');
  const recordingStatus = document.getElementById('recordingStatus');

  toggleRecordingButton.textContent = isRecording ? "Stop Recording" : "Start Recording";
  toggleRecordingButton.style.backgroundColor = isRecording ? "#f44336" : "#4CAF50";
  recordingStatus.textContent = isRecording ? `Recording: ${currentScriptName}` : "Not recording";
}

function loadSavedScripts() {
  chrome.storage.local.get('savedScripts', function(data) {
    const savedScripts = data.savedScripts || {};
    const select = document.getElementById('savedScripts');
    select.innerHTML = '<option value="">Select a saved script</option>';
    for (const scriptName in savedScripts) {
      const option = document.createElement('option');
      option.value = scriptName;
      option.textContent = scriptName;
      select.appendChild(option);
    }
  });
}

function loadSavedScript() {
  const scriptName = document.getElementById('savedScripts').value;
  if (scriptName) {
    chrome.storage.local.get('savedScripts', function(data) {
      const savedScripts = data.savedScripts || {};
      const steps = savedScripts[scriptName];
      if (steps) {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: "loadSteps",
            steps: steps
          });
        });
      }
    });
  }
}

async function fetchCRMData(elements) {
  const formId = document.getElementById('formId')?.value;
  if (!formId) {
    showFeedback("Please enter a Form ID", elements);
    return;
  }
  
  showFeedback("Fetching CRM data...", elements);
  chrome.runtime.sendMessage({action: "fetchCRMData", formId: formId}, function(response) {
    if (response && response.success) {
      crmFields = Object.keys(response.data);
      displayMappingInterface(crmFields, elements);
    } else {
      showFeedback("Error fetching CRM data: " + (response ? response.error : "Unknown error"), elements);
    }
  });
}

// async function createFieldMappings() {
//   const formId = document.getElementById('formId').value;
//   if (formId) {
//     try {
//       const response = await chrome.runtime.sendMessage({action: "fetchFormData", formId: formId});
//       if (response.success) {
//         chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
//           chrome.tabs.sendMessage(tabs[0].id, {
//             action: "createFieldMappings",
//             formData: response.data
//           }, function(mappingResponse) {
//             if (mappingResponse.success) {
//               chrome.storage.local.set({currentFieldMappings: mappingResponse.mappings});
//               showFeedback("Field mappings created successfully");
//             }
//           });
//         });
//       } else {
//         throw new Error(response.error);
//       }
//     } catch (error) {
//       console.error('Error creating field mappings:', error);
//       showFeedback("Error creating field mappings");
//     }
//   }
// }

function createFieldMappings(inputs) {
    const mappingContainer = document.getElementById('mappingContainer');
    mappingContainer.innerHTML = ''; // Clear existing mappings
    
    inputs.forEach(input => {
        const mappingRow = document.createElement('div');
        mappingRow.className = 'mapping-row';
        
        // Name of the field (left side)
        const fieldNameLabel = document.createElement('label');
        fieldNameLabel.textContent = 'Name of the field: ';
        
        const fieldNameInput = document.createElement('input');
        fieldNameInput.type = 'text';
        fieldNameInput.className = 'field-name-input';
        
        // Reference in PMG website (right side)
        const referenceLabel = document.createElement('label');
        referenceLabel.textContent = 'Reference in PMG website: ';
        
        const referenceInput = document.createElement('input');
        referenceInput.type = 'text';
        referenceInput.className = 'reference-input';
        referenceInput.value = input.identifier; // Set the identifier here
        referenceInput.readOnly = true; // Make it read-only since it's the selector
        
        // Append elements
        mappingRow.appendChild(fieldNameLabel);
        mappingRow.appendChild(fieldNameInput);
        mappingRow.appendChild(referenceLabel);
        mappingRow.appendChild(referenceInput);
        
        mappingContainer.appendChild(mappingRow);
    });
}

function showFeedback(message, elements) {
  if (elements.feedback) {
    elements.feedback.textContent = message;
    elements.feedback.style.display = 'block';
  }
  console.log("Feedback:", message);
}

// Call this function when the popup is opened
document.addEventListener('DOMContentLoaded', loadSavedScripts);

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('fetchData').addEventListener('click', fetchCRMData);
  document.getElementById('saveMapping').addEventListener('click', saveMapping);
  document.getElementById('startRecording').addEventListener('click', startRecording);
  document.getElementById('stopRecording').addEventListener('click', stopRecording);
  document.getElementById('saveConfiguration').addEventListener('click', saveConfiguration);
  document.getElementById('runConfiguration').addEventListener('click', runConfiguration);
  document.getElementById('deleteConfiguration').addEventListener('click', deleteConfiguration);
  
  loadConfigurations();
});

function displayMappingInterface(fields, elements) {
  if (!elements.mappingSection || !elements.fieldMappings) {
    showFeedback("Error: Mapping interface elements not found", elements);
    return;
  }
  
  elements.fieldMappings.innerHTML = '';
  
  fields.forEach(field => {
    const mappingRow = document.createElement('div');
    mappingRow.className = 'mapping-row';
    mappingRow.innerHTML = `
      <label>${field}:</label>
      <input type="text" id="mapping_${field}" placeholder="Not mapped yet" readonly>
    `;
    elements.fieldMappings.appendChild(mappingRow);
  });
  
  elements.mappingSection.style.display = 'block';
  showFeedback("CRM fields loaded. Click 'Start Mapping' to begin.", elements);
}

function startMapping(elements) {
  isMapping = true;
  currentMappingField = crmFields[0];
  if (elements.startMapping) elements.startMapping.style.display = 'none';
  if (elements.stopMapping) elements.stopMapping.style.display = 'block';
  
  updateMappingStatus(elements);
  
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {action: "startMapping", fields: crmFields});
  });
}

function stopMapping(elements) {
  isMapping = false;
  currentMappingField = null;
  if (elements.startMapping) elements.startMapping.style.display = 'block';
  if (elements.stopMapping) elements.stopMapping.style.display = 'none';
  
  updateMappingStatus(elements);
  
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {action: "stopMapping"});
  });
}

function updateMappingStatus(elements) {
  if (elements.mappingStatus) {
    if (isMapping) {
      elements.mappingStatus.textContent = `Mapping in progress: Click on the field for "${currentMappingField}"`;
    } else {
      elements.mappingStatus.textContent = "Mapping stopped";
    }
  }
}

function showFeedback(message, elements) {
  if (elements.feedback) {
    elements.feedback.textContent = message;
    elements.feedback.style.display = 'block';
  }
  console.log("Feedback:", message);
}

// Add this new function to handle field mapping updates
function updateFieldMapping(field, selector) {
  const mappingInput = document.getElementById(`mapping_${field}`);
  if (mappingInput) {
    mappingInput.value = selector;
  }
  currentMapping[field] = selector;
  
  // Move to the next field
  const currentIndex = crmFields.indexOf(field);
  if (currentIndex < crmFields.length - 1) {
    currentMappingField = crmFields[currentIndex + 1];
  } else {
    isMapping = false;
    currentMappingField = null;
  }
  updateMappingStatus(elements);
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "fieldMapped") {
    updateFieldMapping(request.crmField, request.selector);
  }
});

function saveMapping() {
  const mappingInputs = document.querySelectorAll('[id^="mapping_"]');
  mappingInputs.forEach(input => {
    const crmField = input.id.replace('mapping_', '');
    const websiteSelector = input.value;
    if (websiteSelector) {
      currentMapping[crmField] = websiteSelector;
    }
  });
  showFeedback("Mapping saved");
}

function startRecording() {
  isRecording = true;
  recordedSteps = [];
  document.getElementById('startRecording').style.display = 'none';
  document.getElementById('stopRecording').style.display = 'block';
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {action: "startRecording"});
  });
  showFeedback("Recording started");
}

function stopRecording() {
  isRecording = false;
  document.getElementById('startRecording').style.display = 'block';
  document.getElementById('stopRecording').style.display = 'none';
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {action: "stopRecording"}, function(response) {
      recordedSteps = response.steps;
      showFeedback("Recording stopped");
    });
  });
}

function saveConfiguration() {
  const configName = document.getElementById('configName').value;
  if (!configName) {
    showFeedback("Please enter a configuration name");
    return;
  }
  
  const configuration = {
    name: configName,
    mapping: currentMapping,
    steps: recordedSteps
  };
  
  chrome.storage.sync.get('configurations', function(data) {
    const configurations = data.configurations || {};
    configurations[configName] = configuration;
    chrome.storage.sync.set({configurations: configurations}, function() {
      showFeedback("Configuration saved");
      loadConfigurations();
    });
  });
}

function loadConfigurations() {
  chrome.storage.sync.get('configurations', function(data) {
    const configurations = data.configurations || {};
    const select = document.getElementById('savedConfigurations');
    select.innerHTML = '<option value="">Select a saved configuration</option>';
    for (const [name, config] of Object.entries(configurations)) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
  });
}

function runConfiguration() {
  const configName = document.getElementById('savedConfigurations').value;
  if (!configName) {
    showFeedback("Please select a configuration");
    return;
  }
  
  chrome.storage.sync.get('configurations', function(data) {
    const configuration = data.configurations[configName];
    if (configuration) {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "runConfiguration",
          configuration: configuration
        });
      });
      showFeedback("Running configuration: " + configName);
    } else {
      showFeedback("Configuration not found");
    }
  });
}

function deleteConfiguration() {
  const configName = document.getElementById('savedConfigurations').value;
  if (!configName) {
    showFeedback("Please select a configuration to delete");
    return;
  }
  
  chrome.storage.sync.get('configurations', function(data) {
    const configurations = data.configurations || {};
    delete configurations[configName];
    chrome.storage.sync.set({configurations: configurations}, function() {
      showFeedback("Configuration deleted");
      loadConfigurations();
    });
  });
}

function createDefaultMapping() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {action: "scanPageInputs"}, function(response) {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
                return;
            }
            
            if (response && response.inputs) {
                createFieldMappings(response.inputs);
            }
        });
    });
}
