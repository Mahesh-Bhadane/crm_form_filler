import { fieldOptionsWithExamples } from "./fieldOptions.js";

let isDataLoaded = false;
let isResponseTableVisible = true;

const API_BASE_URL = "https://base.amberstudent.com";

function ensureContentScriptLoaded(callback) {
  chrome.tabs.query(
    { active: true, currentWindow: true },
    async function (tabs) {
      if (!tabs[0]?.id) {
        showFeedback("No active tab found");
        return;
      }

      try {
        const response = await Promise.race([
          chrome.tabs.sendMessage(tabs[0].id, { action: "ping" }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 1000)
          ),
        ]);
        callback();
      } catch (error) {
        console.log("Injecting content script...");
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ["content.js"],
          });
          setTimeout(callback, 500);
        } catch (err) {
          showFeedback("Error injecting content script: " + err.message);
        }
      }
    }
  );
}

function createDefaultMapping() {
  ensureContentScriptLoaded(() => {
    const mappingContainer = document.querySelector("#mappingContainer, [name='mappingContainer']");
    if (!mappingContainer) {
      showFeedback("Error: Mapping container not found");
      return;
    }
    mappingContainer.innerHTML = ""; 
    createFieldMappings([]);
  // ensureContentScriptLoaded(() => {
  //   chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
  //     if (!tabs[0]?.id) {
  //       showFeedback("No active tab found");
  //       return;
  //     }

  //     chrome.tabs.sendMessage(
  //       tabs[0].id,
  //       { action: "scanPageInputs" },
  //       function (response) {
  //         if (chrome.runtime.lastError) {
  //           showFeedback(
  //             "Error scanning page: " + chrome.runtime.lastError.message
  //           );
  //           return;
  //         }

  //         if (response && response.inputs && response.inputs.length > 0) {
  //           createFieldMappings(response.inputs);
  //         } else {
  //           showFeedback("No input fields found on the page");
  //         }
  //       }
  //     );
  //   });
  });
}

async function submitFormId(elements) {
  const formId = document.querySelector("#formId, [name='formId']")?.value;
  const providerId =
    document.querySelector(".provider-input").dataset.providerId;

  if (!formId || !providerId) {
    showFeedback("Please enter a Form ID and select a Provider", elements);
    return;
  }

  const submitButton = document.querySelector("#submitFormId, [name='submitFormId']");
  submitButton.disabled = true;
  submitButton.textContent = "Loading...";

  try {
    const providerResponse = await fetch(
      `${API_BASE_URL}/crm_form_fillers?provider_id=${providerId}`
    );
    const providerData = await providerResponse.json();

    if (providerData.message !== "success") {
      throw new Error("Failed to fetch provider data");
    }

    if (!providerData.data.result || providerData.data.result.length === 0) {
      showFeedback("Mapping does not exist..!!", elements);
      return; 
    }

    const data = providerData.data.result;

    const formResponse = await fetchForm(formId);

    if (formResponse) {
      const formData = formResponse.data;
      console.log({ formData });

      // Loop through the fetched data and prefill the input fields
      data.forEach((item) => {
        ensureContentScriptLoaded(() => {
          chrome.tabs.query(
            { active: true, currentWindow: true },
            function (tabs) {
              if (!tabs[0]?.id) return;

              console.log("Injecting content script...");

              setTimeout(() => {
                const referenceIdentifier =
                  item.referencein_pmg_website.replace("#", "");
                console.log(referenceIdentifier);
                chrome.tabs.sendMessage(
                  tabs[0].id,
                  {
                    action: "highlightElement",
                    identifier: referenceIdentifier,
                  },
                  function (response) {
                    if (chrome.runtime.lastError) {
                      console.warn(
                        "Error highlighting element: " +
                          chrome.runtime.lastError.message
                      );
                      return;
                    }
                    console.log("Response from content script:", response);

                    const valueToFill = getValueFromPath(
                      formData,
                      item.external_reference_key
                    );
                    displayKeyValueTable(referenceIdentifier, valueToFill);
                  }
                );

                const externalKey = item.external_reference_key;

                const valueToFill = getValueFromPath(formData, externalKey);
                const identifier = item.value_of_the_field;
                // Check if referenceIdentifier is 'firstName' and split it
                const processedValueToFill = (identifier === 'firstName' || identifier === 'first_name')
                    ? valueToFill.split(' ')[0] 
                    : (identifier === 'lastName' || identifier === 'last_name')
                        ? valueToFill.split(' ').slice(1).join(' ') 
                        : identifier === 'dateOfBirth'
                            ? formatDate(valueToFill)
                            : valueToFill;


                if (valueToFill !== undefined) {
                  chrome.tabs.sendMessage(
                    tabs[0].id,
                    {
                      action: "fillInputField",
                      identifier: referenceIdentifier,
                      value: processedValueToFill,
                    },
                    function (response) {
                      if (chrome.runtime.lastError) {
                        console.warn(
                          "Error filling input field: " +
                            chrome.runtime.lastError.message
                        );
                      } else {
                        console.log(
                          "Successfully filled input field:",
                          response
                        );
                      }
                    }
                  );
                } else {
                  console.warn(
                    "Value to fill is undefined for externalKey:",
                    externalKey
                  );
                }
              }, 100);
            }
          );
        });
      });

      showFeedback("Data prefetched successfully..!!", elements);
    } else {
      showFeedback(
        "Error fetching CRM data: " +
          (formResponse ? formResponse.error : "Unknown error"),
        elements
      );
    }
  } catch (error) {
    showFeedback("Error fetching data: " + error.message, elements);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Prefill Data";
  }
}

async function fetchForm(formId) {
    const response = await fetch(`${API_BASE_URL}/forms/${formId}`);
  
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  
    const responseData = await response.json();
    return responseData;
  }

function getValueFromPath(obj, path) {
  return path.split(".").reduce((o, key) => (o || {})[key], obj);
}

function createFieldMappings(inputs) {
  const mappingContainer = document.querySelector("#mappingContainer, [name='mappingContainer']");
  if (!mappingContainer) {
    showFeedback("Error: Mapping container not found");
    return;
  }

  mappingContainer.innerHTML = "";

  // inputs.forEach((input, index) => {
    const mappingCard = document.createElement("div");
    mappingCard.className = "mapping-card";

    const buttonContainer = document.createElement("div");
    buttonContainer.className = "button-container";

    const addButton = document.createElement("button");
    addButton.className = "mapping-btn add-btn";
    addButton.innerHTML = "+";
    addButton.title = "Add new mapping below";
    addButton.onclick = (e) => {
      const currentCard = e.target.closest(".mapping-card");
      const newCard = mappingCard.cloneNode(true);

      // Reset inputs and message for the new card
      newCard.querySelectorAll("input").forEach((input) => (input.value = ""));
      const newReferenceInput = newCard.querySelector(".reference-input");
      newReferenceInput.readOnly = false;

      // Reset and show the message for the new card
      const newMessageElement = newCard.querySelector(".info-message");
      if (newMessageElement) {
        newMessageElement.style.display = "block";
      }

      const newFieldNameInput = newCard.querySelector(".field-name-input");
      const newDropdownList = newCard.querySelector(".dropdown-list");
      const newExampleInput = newCard.querySelector(".example-input");

      newFieldNameInput.disabled = true;

      // Update the record keybind button for the new card
      const newRecordKeybindBtn = newCard.querySelector(".record-keybind-btn");
      if (newRecordKeybindBtn) {
        newRecordKeybindBtn.style.display = "block";
        newRecordKeybindBtn.style.backgroundColor = ""; // Reset button color
        newRecordKeybindBtn.onclick = () => {
          if (newReferenceInput) {
            newReferenceInput.readOnly = false;
            newFieldNameInput.disabled = false;
            startRecordingKeybind(newReferenceInput, newRecordKeybindBtn);
          }
        };
      }

      // Rest of the existing add button code...
      newFieldNameInput.onclick = (e) => {
        e.stopPropagation();
        newDropdownList.classList.toggle("hidden");
      };

      newDropdownList.innerHTML = "";
      Object.keys(fieldOptionsWithExamples).forEach((option) => {
        const optionElement = document.createElement("div");
        optionElement.className = "dropdown-option";
        optionElement.textContent = option;
        optionElement.onclick = () => {
          newFieldNameInput.value = option;
          newExampleInput.value = fieldOptionsWithExamples[option]?.example || "";
          newDropdownList.classList.add("hidden");
        };
        newDropdownList.appendChild(optionElement);
      });

      newFieldNameInput.oninput = (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const options = newDropdownList.querySelectorAll(".dropdown-option");
        options.forEach((option) => {
          const text = option.textContent.toLowerCase();
          option.style.display = text.includes(searchTerm) ? "block" : "none";
        });

        newDropdownList.classList.remove("hidden");
      };

      newFieldNameInput.onclick = () => {
        newDropdownList.classList.remove("hidden");
      };

      newFieldNameInput.onfocus = () => {
        newDropdownList.classList.remove("hidden");
      };

      document.addEventListener("click", (e) => {
        if (
          !newFieldNameInput.contains(e.target) &&
          !newDropdownList.contains(e.target)
        ) {
          newDropdownList.classList.add("hidden");
        }
      });

      newCard.querySelector(".add-btn").onclick = addButton.onclick;
      newCard.querySelector(".remove-btn").onclick = () => newCard.remove();
      currentCard.after(newCard);
    };

    const removeButton = document.createElement("button");
    removeButton.className = "mapping-btn remove-btn";
    removeButton.innerHTML = "x";
    removeButton.title = "Remove this mapping";
    removeButton.onclick = () => mappingCard.remove();

    buttonContainer.appendChild(addButton);
    buttonContainer.appendChild(removeButton);
    mappingCard.appendChild(buttonContainer);

    // 1. Reference section
    const referenceSection = document.createElement("div");
    referenceSection.className = "mapping-section";
    const referenceLabel = document.createElement("label");
    referenceLabel.textContent = "Reference in PMG website:";
    const referenceInput = document.createElement("input");
    referenceInput.type = "text";
    referenceInput.className = "reference-input";
    // referenceInput.value = input.identifier;
    referenceInput.readOnly = true;

    const messageReferenceElement = document.createElement("div");
    messageReferenceElement.className = "info-message"; 
    messageReferenceElement.textContent = "Please select input field in the form."; 
    messageReferenceElement.style.color = "black"; 
    messageReferenceElement.style.display = "block";

    // Add Record Keybind button
    const recordKeybindBtn = document.createElement("button");
    recordKeybindBtn.className = "record-keybind-btn";
    recordKeybindBtn.textContent = "Record Keybind";
    recordKeybindBtn.onclick = () => {
      const referenceInput = mappingCard.querySelector(".reference-input");
      if (referenceInput) {
        referenceInput.readOnly = false;
        fieldNameInput.disabled = false; 
        startRecordingKeybind(referenceInput, recordKeybindBtn);
      }
    };

    referenceSection.appendChild(referenceLabel);
    referenceSection.appendChild(referenceInput);
    referenceSection.appendChild(recordKeybindBtn);
    referenceSection.appendChild(messageReferenceElement); 


    // Add click handler to reference input
    referenceInput.addEventListener("click", function () {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs[0]?.id) return;

        chrome.tabs.sendMessage(tabs[0].id, {
          action: "highlightElement",
          identifier: input.identifier,
        });
      });
    });

    // 2. Name of the field section
    const fieldNameSection = document.createElement("div");
    fieldNameSection.className = "mapping-section";
    const fieldNameLabel = document.createElement("label");
    fieldNameLabel.textContent = "Value in API response:";

    const fieldNameWrapper = document.createElement("div");
    fieldNameWrapper.className = "field-name-wrapper";

    const fieldNameInput = document.createElement("input");
    fieldNameInput.type = "text";
    fieldNameInput.className = "field-name-input";
    fieldNameInput.placeholder = "Type or select a field";
    fieldNameInput.disabled = true;
    fieldNameInput.title = "Please fill value in Reference in PMG website"; 

    const dropdownList = document.createElement("div");
    dropdownList.className = "dropdown-list hidden";

    Object.keys(fieldOptionsWithExamples).forEach((option) => {
      const optionElement = document.createElement("div");
      optionElement.className = "dropdown-option";
      optionElement.textContent = option;
      optionElement.onclick = () => {
        fieldNameInput.value = option;
        exampleInput.value = fieldOptionsWithExamples[option]?.example || "";
        dropdownList.classList.add("hidden");
      };
      dropdownList.appendChild(optionElement);
    });

    fieldNameInput.oninput = (e) => {
      const searchTerm = e.target.value.toLowerCase();
      const options = dropdownList.querySelectorAll(".dropdown-option");

      options.forEach((option) => {
        const text = option.textContent.toLowerCase();
        option.style.display = text.includes(searchTerm) ? "block" : "none";
      });

      dropdownList.classList.remove("hidden");
    };

    fieldNameInput.onfocus = () => {
      dropdownList.classList.remove("hidden");
    };

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (!fieldNameWrapper.contains(e.target)) {
        dropdownList.classList.add("hidden");
      }
    });

    fieldNameWrapper.appendChild(fieldNameInput);
    fieldNameWrapper.appendChild(dropdownList);
    fieldNameSection.appendChild(fieldNameLabel);
    fieldNameSection.appendChild(fieldNameWrapper);

    // Update the example section
    const exampleSection = document.createElement("div");
    exampleSection.className = "mapping-section";
    const exampleLabel = document.createElement("label");
    exampleLabel.textContent = "Example like API response:";
    const exampleInput = document.createElement("input");
    exampleInput.type = "text";
    exampleInput.className = "example-input";
    exampleInput.readOnly = true;
    exampleInput.placeholder = "Example value will appear here";
    exampleSection.appendChild(exampleLabel);
    exampleSection.appendChild(exampleInput);

    // Update the order of sections in the card
    mappingCard.appendChild(referenceSection);
    mappingCard.appendChild(fieldNameSection);
    mappingCard.appendChild(exampleSection);
    mappingContainer.appendChild(mappingCard);
  // });

  // After the loop that creates mapping cards, add the submit button
  const submitButton = document.createElement("button");
  submitButton.id = "submitMapping";
  submitButton.className = "submit-mapping-btn";
  submitButton.style.backgroundColor = "green";
  submitButton.textContent = "Submit Mapping";
  submitButton.addEventListener("click", async function () {
    const mappingCards = document.querySelectorAll(".mapping-card");
    const providerInput = document.querySelector(".provider-input");
    const selectedProvider = providerInput.value;

    if (!selectedProvider) {
      showFeedback("Please select a provider first!");
      return;
    }

    const mappingData = {
      crm_form_filler: {
        provider_name: selectedProvider,
        provider_id: parseInt(providerInput.dataset.providerId),
        form_mappings: [],
      },
    };

    mappingCards.forEach((card) => {
      const selectedFieldName = card.querySelector(".field-name-input").value;
      const externalReferenceKey =
        fieldOptionsWithExamples[selectedFieldName]?.external_reference_key ||
        "";

      const mapping = {
        referencein_pmg_website: card.querySelector(".reference-input").value,
        value_of_the_field: card.querySelector(".field-name-input").value,
        examplein_api_response: card.querySelector(".example-input").value,
        external_reference_key: externalReferenceKey,
      };
      mappingData.crm_form_filler.form_mappings.push(mapping);
    });

    console.log("Sending mapping data:", mappingData);

    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";

    try {
      // Make a POST request to the API
      const response = await fetch(`${API_BASE_URL}/crm_form_fillers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mappingData),
      });

      const result = await response.json();

      if (response.ok) {
        document.getElementById("mappingContainer").style.display = "none";
        displayMsg("Mapping saved successfully!");
        displayResponseTable(result.data);
      } else {
        displayMsg(
          "Error saving mapping data: " + (result.error || "Unknown error")
        );
      }
    } catch (error) {
      displayMsg("Error sending message: " + error.message);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Submit Mapping";
    }
  });

  mappingContainer.appendChild(submitButton);
}

async function fetchProviders() {
  let loader; 
  try {
    let allProviders = [];
    let page = 1;
    let hasMoreData = true;
    const pageSize = 100; 

    loader = document.createElement("div");
    loader.className = "loader";
    loader.innerHTML = `<div class="spinner"></div>`;
    document.body.appendChild(loader);

    while (hasMoreData) {
      const response = await fetch(
        `${API_BASE_URL}/providers?p=${page}&limit=${pageSize}&sort_key=created&sort_order=desc&type=all`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const providers = data.data.result;

      if (providers.length === 0) {
        hasMoreData = false;
      } else {
        allProviders = [...allProviders, ...providers];
        page++;
      }
    }

    showFeedback(`Successfully loaded ${allProviders.length} providers`);
    return allProviders;
  } catch (error) {
    console.error("Error fetching providers:", error);
    showFeedback("Error fetching providers: " + error.message);
    return [];
  } finally {
    if (loader) {
      document.body.removeChild(loader);
    }
  }
}

document.addEventListener("DOMContentLoaded", async function () {
  const providers = await fetchProviders();

  const containerDiv = document.createElement("div");
  const providerWrapper = document.createElement("div");
  providerWrapper.className = "provider-wrapper";

  const providerInput = document.createElement("input");
  providerInput.type = "text";
  providerInput.className = "provider-input";
  providerInput.placeholder = "Search providers...";

  providerInput.addEventListener("input", () => {
    const searchTerm = providerInput.value.toLowerCase();
    const options = providerDropdown.querySelectorAll(".provider-option");

    options.forEach((option) => {
      const text = option.textContent.toLowerCase();
      option.style.display = text.includes(searchTerm) ? "block" : "none";
    });
  });

  const providerDropdown = document.createElement("div");
  providerDropdown.className = "provider-dropdown hidden";

  providerInput.onclick = (e) => {
    e.stopPropagation();
    providerDropdown.classList.toggle("hidden");
  };

  document.addEventListener("click", () => {
    providerDropdown.classList.add("hidden");
  });

  providers.forEach((provider) => {
    const option = document.createElement("div");
    option.className = "provider-option";
    option.textContent = provider.name.replace(/\b\w/g, (char) =>
      char.toUpperCase()
    );
    option.onclick = () => {
      providerInput.value = provider.name.replace(/\b\w/g, (char) =>
        char.toUpperCase()
      );
      providerInput.dataset.providerId = provider.id;
      providerDropdown.classList.add("hidden");
      const createMappingButton = document.getElementById(
        "createDefaultMapping"
      );
      const fetchCRMButton = document.getElementById("fetchCRMData");
      if (createMappingButton) createMappingButton.style.display = "block";
      if (fetchCRMButton) fetchCRMButton.style.display = "block";

      showFeedback("");
      feedback.style.display = "none";
    };
    providerDropdown.appendChild(option);
  });

  providerWrapper.appendChild(providerInput);
  providerWrapper.appendChild(providerDropdown);
  containerDiv.appendChild(providerWrapper);

  providerSelect.parentNode.replaceChild(containerDiv, providerSelect);

  const createMappingButton = document.getElementById("createDefaultMapping");
  const fetchCRMButton = document.getElementById("fetchCRMData");

  providerInput.addEventListener("change", function () {
    if (this.value) {
      createMappingButton.style.display = "block";
    } else {
      createMappingButton.style.display = "none";
    }
  });

  if (createMappingButton) {
    createMappingButton.addEventListener("click", () => {
      const mappingContainer = document.querySelector("#mappingContainer, [name='mappingContainer']");

      if (
        mappingContainer.style.display === "none" ||
        !mappingContainer.style.display
      ) {
        createDefaultMapping();
        mappingContainer.style.display = "block";
        if (fetchCRMButton) {
          fetchCRMButton.style.display = "block";
        }
      } else {
        mappingContainer.style.display = "none";
        if (fetchCRMButton) {
          fetchCRMButton.style.display = "block";
        }
      }
    });
  }

  if (fetchCRMButton) {
    fetchCRMButton.addEventListener("click", () => {
      const crmDataInputs = document.getElementById("crmDataInputs");
      const keyValueTableContainer = document.querySelector("#keyValueTableContainer, [name='keyValueTableContainer']");
      const responseTableContainer = document.querySelector("#responseTableContainer, [name='responseTableContainer']");

      if (crmDataInputs) {
        if (
          crmDataInputs.style.display === "none" ||
          !crmDataInputs.style.display
        ) {
          if (!isDataLoaded) {
            submitFormId(); 
            isDataLoaded = true; 
          }
          crmDataInputs.style.display = "block";
          if (keyValueTableContainer) {
            keyValueTableContainer.style.display = "block"; 
          }
          if (responseTableContainer) {
            responseTableContainer.style.display = "none"; 
            isResponseTableVisible = false; 
          }
        } else {
          crmDataInputs.style.display = "none";
          if (keyValueTableContainer) {
            keyValueTableContainer.style.display = "none"; 
          }
          if (responseTableContainer) {
            responseTableContainer.style.display = "block"; 
            isResponseTableVisible = true; 
          }
        }
      }
    });
  }

  const submitButton = document.querySelector("#submitFormId, [name='submitFormId']");
  if (submitButton) {
    submitButton.addEventListener("click", submitFormId);
  }
  // Check for provider_id in URL parameters
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs[0]) {
      let currentTabUrl = tabs[0].url;

      const url = new URL(currentTabUrl.split('?')[0] + '?' + currentTabUrl.split('?').slice(1).join('&'));
      const providerId = url.searchParams.get("provider_id");
      const formId = url.searchParams.get("form_id");
      
      if (providerId) {
        const provider = providers.find(p => p.id === parseInt(providerId));
        if (provider) {
          providerInput.value = provider.name.replace(/\b\w/g, (char) => char.toUpperCase());
          providerInput.dataset.providerId = provider.id;
          if (createMappingButton) createMappingButton.style.display = "block";
          if (fetchCRMButton) fetchCRMButton.style.display = "block";
          localStorage.setItem("providerId", providerId);
        }
      } else {
        const storedProviderId = localStorage.getItem("providerId");
        if (storedProviderId) {
          const provider = providers.find(p => p.id === parseInt(storedProviderId));
          if (provider) {
            providerInput.value = provider.name.replace(/\b\w/g, (char) => char.toUpperCase());
            providerInput.dataset.providerId = provider.id;
            if (createMappingButton) createMappingButton.style.display = "block";
            if (fetchCRMButton) fetchCRMButton.style.display = "block";
          }
        }
      }

      if (formId) {
        document.getElementById("formId").value = formId;
        localStorage.setItem("formId", formId);
      } else {
        const storedFormId = localStorage.getItem("formId");
        if (storedFormId) {
          document.getElementById("formId").value = storedFormId;
        }
      }

    } else {
      console.log("No active tab found.");
    }
  });
});

function showFeedback(message) {
  const feedback = document.getElementById("feedback");
  if (feedback) {
    feedback.textContent = message;
    feedback.style.display = "block";

    setTimeout(() => {
      feedback.style.display = "none";
    }, 3000);
  }
  console.log("Feedback:", message);
}

function displayMsg(message) {
  const msg = document.getElementById("msg");
  if (msg) {
    msg.textContent = message;
    msg.style.display = "block";

    setTimeout(() => {
      msg.style.display = "none";
    }, 3000);
  }
  console.log("msg:", message);
}

function startRecordingKeybind(referenceInput, recordButton) {
  recordButton.classList.add("recording");
  recordButton.style.backgroundColor = "red";

  // Find the info message element that's a sibling of the referenceInput
  const messageElement = referenceInput.parentElement.querySelector('.info-message');

  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]?.id) return;

    chrome.tabs.sendMessage(
      tabs[0].id,
      {
        action: "startRecordingKeybind",
      },
      function (response) {
        if (chrome.runtime.lastError) {
          showFeedback(
            "Error starting recording: " + chrome.runtime.lastError.message
          );
          stopRecording(recordButton);
          return;
        }

        showFeedback("Click on an input field in the page...");

        chrome.runtime.onMessage.addListener(function recordingListener(
          message
        ) {
          if (message.action === "keybindRecorded") {
            referenceInput.value = message.identifier;
            
            // Hide the message when keybind is recorded
            if (messageElement) {
              messageElement.style.display = "none";
            }

            referenceInput.onclick = function () {
              chrome.tabs.query(
                { active: true, currentWindow: true },
                function (tabs) {
                  if (!tabs[0]?.id) return;

                  chrome.tabs.sendMessage(tabs[0].id, {
                    action: "highlightElement",
                    identifier: message.identifier,
                  });
                }
              );
            };

            showFeedback("Input recorded successfully!");
            stopRecording(recordButton);
            chrome.runtime.onMessage.removeListener(recordingListener);
          }
        });
      }
    );
  });
}

function stopRecording(recordButton) {
  recordButton.classList.remove("recording");
  recordButton.style.backgroundColor = "";
}

document
  .getElementById("providerSelect")
  .addEventListener("change", function () {
    const fetchCRMButton = document.getElementById("fetchCRMData");
    fetchCRMButton.style.display = this.value ? "block" : "none";
  });

function displayResponseTable(data) {
  let tableContainer = document.getElementById("responseTableContainer");
  if (!tableContainer) {
    tableContainer = document.createElement("div");
    tableContainer.id = "responseTableContainer";
    document.body.appendChild(tableContainer);
  }

  tableContainer.innerHTML = "";

  const providerName =
    data.length > 0 ? data[0].provider_name : "Unknown Provider";
  const providerId = data.length > 0 ? data[0].provider_id : "Unknown ID";

  const providerInfo = document.createElement("div");
  providerInfo.className = "provider-info";
  providerInfo.innerHTML = `<strong>Provider Name:</strong> ${providerName} <br> <strong>Provider ID:</strong> ${providerId}`;
  tableContainer.appendChild(providerInfo);

  const tableWrapper = document.createElement("div");
  tableWrapper.className = "table-wrapper"; 
  tableContainer.appendChild(tableWrapper);

  const table = document.createElement("table");
  table.className = "response-table";

  const headerRow = document.createElement("tr");
  const headers = [
    "ID",
    "Reference in PMG Website",
    "Value of the Field",
    "External Reference Key",
    "Example in API Response",
  ];
  headers.forEach((headerText) => {
    const header = document.createElement("th");
    header.textContent = headerText;
    headerRow.appendChild(header);
  });
  table.appendChild(headerRow);

  data.forEach((item) => {
    if (item.value_of_the_field) {
      const row = document.createElement("tr");
      const rowData = [
        item.id,
        item.referencein_pmg_website,
        item.value_of_the_field,
        item.external_reference_key,
        item.examplein_api_response,
      ];
      rowData.forEach((text) => {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.appendChild(cell);
      });
      table.appendChild(row);
    }
  });

  tableWrapper.appendChild(table);
  document.body.appendChild(tableContainer);
}

function displayKeyValueTable(key, value) {
  const responseTableContainer = document.getElementById(
    "responseTableContainer"
  );
  if (responseTableContainer && isResponseTableVisible) {
    responseTableContainer.style.display = "none"; 
    isResponseTableVisible = false; 
  }

  let tableContainer = document.getElementById("keyValueTableContainer");
  if (!tableContainer) {
    tableContainer = document.createElement("div");
    tableContainer.id = "keyValueTableContainer";
    document.body.appendChild(tableContainer);

    const scrollableContainer = document.createElement("div");
    scrollableContainer.className = "scrollable-table-container"; 

    const table = document.createElement("table");
    table.className = "key-value-table";

    const headerRow = document.createElement("tr");
    const headers = ["Key", "Value"];
    headers.forEach((headerText) => {
      const header = document.createElement("th");
      header.textContent = headerText;
      headerRow.appendChild(header);
    });
    table.appendChild(headerRow);
    scrollableContainer.appendChild(table); // Append table to scrollable container
    tableContainer.appendChild(scrollableContainer); // Append scrollable container to main container
  }

  const table = tableContainer.querySelector("table");
  const existingRow = Array.from(table.querySelectorAll("tr"))
    .slice(1)
    .find((row) => row.cells[0].textContent === key); 

  if (value) {
    if (existingRow) {
      existingRow.cells[1].textContent = value; 
    } else {
      const row = document.createElement("tr");
      const rowData = [key, value];
      rowData.forEach((text) => {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.appendChild(cell);
      });
      table.appendChild(row);
    }
  } else if (existingRow) {
    table.deleteRow(existingRow.rowIndex);
  }
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); 
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}
