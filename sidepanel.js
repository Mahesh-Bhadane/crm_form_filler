let isDataLoaded = false; // Flag to track if data has been loaded

// Global variable to track the visibility of the response table
let isResponseTableVisible = true;

function ensureContentScriptLoaded(callback) {
  chrome.tabs.query(
    { active: true, currentWindow: true },
    async function (tabs) {
      if (!tabs[0]?.id) {
        showFeedback("No active tab found");
        return;
      }

      try {
        // Try to ping the content script with a timeout
        const response = await Promise.race([
          chrome.tabs.sendMessage(tabs[0].id, { action: "ping" }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 1000)
          ),
        ]);
        callback();
      } catch (error) {
        // If content script isn't ready or times out, inject it
        console.log("Injecting content script...");
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ["content.js"],
          });
          // Wait a bit longer for the content script to initialize
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
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs[0]?.id) {
        showFeedback("No active tab found");
        return;
      }

      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: "scanPageInputs" },
        function (response) {
          if (chrome.runtime.lastError) {
            showFeedback(
              "Error scanning page: " + chrome.runtime.lastError.message
            );
            return;
          }

          if (response && response.inputs && response.inputs.length > 0) {
            createFieldMappings(response.inputs);
            // showFeedback(`Found ${response.inputs.length} input fields`);
          } else {
            showFeedback("No input fields found on the page");
          }
        }
      );
    });
  });
}

async function submitFormId(elements) {
  const formId = document.getElementById("formId")?.value;
  const providerId =
    document.querySelector(".provider-input").dataset.providerId;

  if (!formId || !providerId) {
    showFeedback("Please enter a Form ID and select a Provider", elements);
    return;
  }

  const submitButton = document.getElementById("submitFormId"); // Get the button reference
  submitButton.disabled = true; // Disable the button
  submitButton.textContent = "Loading..."; // Change button text to indicate loading

  try {
    // Fetch form data for prefill
    const providerResponse = await fetch(
      `http://localhost:3002/crm_form_fillers?provider_id=${providerId}`
    );
    const providerData = await providerResponse.json();

    if (providerData.message !== "success") {
      throw new Error("Failed to fetch provider data");
    }

    const data = providerData.data.result;

    // Send the formId to the background script and await the response
    const formResponse = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "submitFormId", formId: formId },
        function (response) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError));
          } else {
            resolve(response);
          }
        }
      );
    });

    if (formResponse && formResponse.success) {
      const formData = formResponse.data; // Assign the response data to formData
      console.log({ formData });

      // Loop through the fetched data and prefill the input fields
      data.forEach((item) => {
        ensureContentScriptLoaded(() => {
          chrome.tabs.query(
            { active: true, currentWindow: true },
            function (tabs) {
              if (!tabs[0]?.id) return;

              console.log("Injecting content script...");

              // Delay sending the message to ensure the content script is ready
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

                    // New code to display the key-value table
                    const valueToFill = getValueFromPath(formData, item.external_reference_key);
                    displayKeyValueTable(referenceIdentifier, valueToFill);
                  }
                );

                // Use formData directly to fill the input field
                const externalKey = item.external_reference_key; // Get the external reference key

                const valueToFill = getValueFromPath(formData, externalKey);
                console.log({ valueToFill });
                if (valueToFill !== undefined) {
                  // Check if the input field is available before sending the message
                  chrome.tabs.sendMessage(
                    tabs[0].id,
                    {
                      action: "fillInputField",
                      identifier: referenceIdentifier,
                      value: valueToFill,
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
              }, 100); // Adjust the delay as necessary
            }
          );
        });
      });

      showFeedback("Data prefetched successfully", elements);
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
    submitButton.disabled = false; // Re-enable the button
    submitButton.textContent = "Prefill Data"; // Reset button text
  }
}

// Helper function to get value from nested object using a path
function getValueFromPath(obj, path) {
  return path.split(".").reduce((o, key) => (o || {})[key], obj);
}

function createFieldMappings(inputs) {
  const mappingContainer = document.getElementById("mappingContainer");
  if (!mappingContainer) {
    showFeedback("Error: Mapping container not found");
    return;
  }

  // Clear existing mappings
  mappingContainer.innerHTML = "";

  // Update field options with examples
  const fieldOptionsWithExamples = {
    university: {
      example: "University of Example",
      external_reference_key: "data_formatted.university",
    },
    yearOfStudy: {
      example: "2024",
      external_reference_key: "data_formatted.enrolment_status",
    },
    firstName: {
      example: "John",
      external_reference_key: "user_details.name",
    },
    lastName: {
      example: "Doe",
      external_reference_key: "user_details.name",
    },
    email: {
      example: "john.doe@example.com",
      external_reference_key: "data_formatted.alternate_email",
    },
    phoneMobileCell: {
      example: "+1234567890",
      external_reference_key: "user_details.phone",
    },
    gender: {
      example: "Male/Female",
      external_reference_key: "data_formatted.gender",
    },
    dateOfBirth: {
      example: "1990-01-01",
      external_reference_key: "data_formatted.dob",
    },
    course: {
      example: "Computer Science",
      external_reference_key: "data_formatted.course",
    },
    nationality: {
      example: "British",
      external_reference_key: "data_formatted.nationality",
    },
    moveInDate: {
      example: "2024-09-01",
      external_reference_key: "data_formatted.moveInDate",
    },
    leaseDuration: {
      example: "12 months",
      external_reference_key: "data_formatted.lease_duration",
    },
    userName: {
      example: "Maha",
      external_reference_key: "user_details.name",
    },
    userEmail: {
      example: "mahataifur@gmail.com",
      external_reference_key: "user_details.email",
    },
    userPhone: {
      example: "923061801802",
      external_reference_key: "user_details.phone",
    },
    userPhoneCountry: {
      example: "PK",
      external_reference_key: "user_details.phone_details.country",
    },
    userPhoneNational: {
      example: "03061801802",
      external_reference_key: "user_details.phone_details.national",
    },
    userPhoneStandard: {
      example: "+92 306 1801802",
      external_reference_key: "user_details.phone_details.standard",
    },
    userPhoneFormatted: {
      example: "+923061801802",
      external_reference_key: "user_details.phone_details.formatted",
    },
    userPhoneCountryCode: {
      example: "92",
      external_reference_key: "user_details.phone_details.country_code",
    },
    userPhoneInternational: {
      example: "923061801802",
      external_reference_key: "user_details.phone_details.international",
    },
    guarantorFirstName: {
      example: "Jane",
      external_reference_key: "data_formatted.guarantor_details.name",
    },
    guarantorLastName: {
      example: "Smith",
      external_reference_key: "data_formatted.guarantor_details.name",
    },
    guarantorDOB: {
      example: "1978-10-03",
      external_reference_key: "data_formatted.guarantor_details.dob",
    },
    guarantorEmail: {
      example: "mohsinalam1@aol.com",
      external_reference_key: "data_formatted.guarantor_details.email",
    },
    guarantorPhone: {
      example: "+923061801802",
      external_reference_key: "data_formatted.guarantor_details.phone",
    },
    guarantorTitle: {
      example: "Miss",
      external_reference_key: "data_formatted.guarantor_details.title",
    },
    guarantorCity: {
      example: "Lahore",
      external_reference_key:
        "data_formatted.guarantor_details.address.city",
    },
    guarantorState: {
      example: "Punjab",
      external_reference_key:
        "data_formatted.guarantor_details.address.state",
    },
    guarantorPostal: {
      example: "54000",
      external_reference_key:
        "data_formatted.guarantor_details.address.postal",
    },
    guarantorCountry: {
      example: "Pakistan",
      external_reference_key:
        "data_formatted.guarantor_details.address.country",
    },
    guarantorAddressLine1: {
      example: "180/2 F block street 10 phase 5 DHA",
      external_reference_key:
        "data_formatted.guarantor_details.address.addr_line1",
    },
    homeAddress: {
      example:
        "180/2 F block street 10 phase 5 DHA, Lahore, Punjab, 54000, Pakistan",
      external_reference_key: "data_formatted.home_address",
    },
    homeCity: {
      example: "Lahore",
      external_reference_key: "data_formatted.home_address.city",
    },
    homeState: {
      example: "Punjab",
      external_reference_key: "data_formatted.home_address.state",
    },
    homePostal: {
      example: "54000",
      external_reference_key: "data_formatted.home_address.postal",
    },
    homeCountry: {
      example: "Pakistan",
      external_reference_key: "data_formatted.home_address.country",
    },
    homeAddressLine1: {
      example: "180/2 F block street 10 phase 5 DHA",
      external_reference_key: "data_formatted.home_address.addr_line1",
    },
    alternateEmail: {
      example: "bintaf78@hotmail.com",
      external_reference_key: "data_formatted.alternate_email",
    },
    enrolmentStatus: {
      example: "First Year Undergraduate",
      external_reference_key: "data_formatted.enrolment_status",
    },
  };

  // Create mapping rows for each input
  inputs.forEach((input, index) => {
    const mappingCard = document.createElement("div");
    mappingCard.className = "mapping-card";

    // Add buttons container
    const buttonContainer = document.createElement("div");
    buttonContainer.className = "button-container";

    // Add button
    const addButton = document.createElement("button");
    addButton.className = "mapping-btn add-btn";
    addButton.innerHTML = "+";
    addButton.title = "Add new mapping below";
    addButton.onclick = (e) => {
      // Get the parent mapping card of the clicked button
      const currentCard = e.target.closest(".mapping-card");
      const newCard = mappingCard.cloneNode(true);

      // Clear input values in the clone
      newCard.querySelectorAll("input").forEach((input) => (input.value = ""));

      // Reset readonly status for reference input in new card
      const newReferenceInput = newCard.querySelector(".reference-input");
      newReferenceInput.readOnly = false;

      // Re-initialize dropdown functionality for the new card
      const newFieldNameInput = newCard.querySelector(".field-name-input");
      const newDropdownList = newCard.querySelector(".dropdown-list");
      const newExampleInput = newCard.querySelector(".example-input");
      const newFieldKeyInput = newCard.querySelector(
        ".external_reference_key_input"
      );

      // Reattach click handler for dropdown toggle
      newFieldNameInput.onclick = (e) => {
        e.stopPropagation();
        newDropdownList.classList.toggle("hidden");
      };

      newDropdownList.innerHTML = ''; 
      Object.keys(fieldOptionsWithExamples).forEach((option) => {
        const optionElement = document.createElement("div");
        optionElement.className = "dropdown-option";
        optionElement.textContent = option;
        optionElement.onclick = () => {
          newFieldNameInput.value = option;
          newExampleInput.value = fieldOptionsWithExamples[option]?.example || "";
        //   newFieldKeyInput.value = fieldOptionsWithExamples[option]?.external_reference_key || "";
          newDropdownList.classList.add("hidden");
        };
        newDropdownList.appendChild(optionElement);
      });

      // Add search functionality for the new dropdown list
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
        if (!newFieldNameInput.contains(e.target) && !newDropdownList.contains(e.target)) {
          newDropdownList.classList.add("hidden");
        }
      });

      // Show record keybind button only in the new card
      const newRecordKeybindBtn = newCard.querySelector(".record-keybind-btn");
      if (newRecordKeybindBtn) {
        newRecordKeybindBtn.style.display = "block";
      }
      newRecordKeybindBtn.onclick = () => {
        const newReferenceInput = newCard.querySelector(".reference-input");
        if (newReferenceInput) {
          newReferenceInput.readOnly = false;
          startRecordingKeybind(newReferenceInput, newRecordKeybindBtn);
        }
      };

      // Reattach button listeners
      newCard.querySelector(".add-btn").onclick = addButton.onclick;
      newCard.querySelector(".remove-btn").onclick = () => newCard.remove();

      // Always insert after the current card
      currentCard.after(newCard);
    };

    // Remove button
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
    referenceInput.value = input.identifier;
    referenceInput.readOnly = true;

    // Add Record Keybind button
    const recordKeybindBtn = document.createElement("button");
    recordKeybindBtn.className = "record-keybind-btn";
    recordKeybindBtn.textContent = "Record Keybind";
    recordKeybindBtn.onclick = () => {
      const referenceInput = mappingCard.querySelector(".reference-input");
      if (referenceInput) {
        referenceInput.readOnly = false;
        startRecordingKeybind(referenceInput, recordKeybindBtn);
      }
    };

    referenceSection.appendChild(referenceLabel);
    referenceSection.appendChild(referenceInput);
    referenceSection.appendChild(recordKeybindBtn);

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
    fieldNameInput.readOnly = false;

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

    // 3: Name of the field section
    const fieldKeySection = document.createElement("div");
    fieldKeySection.className = "mapping-section";
    const fieldKeyLabel = document.createElement("label");
    fieldKeyLabel.textContent = "Field in API response:";
    const fieldKeyInput = document.createElement("input");
    fieldKeyInput.type = "text";
    fieldKeyInput.className = "field-key-input";
    fieldKeyInput.placeholder = `Field name ${index + 1}`;
    fieldKeyInput.readOnly = true;
    fieldKeySection.appendChild(fieldKeyLabel);
    fieldKeySection.appendChild(fieldKeyInput);

    // Update the order of sections in the card
    mappingCard.appendChild(referenceSection);
    mappingCard.appendChild(fieldNameSection);
    mappingCard.appendChild(exampleSection);
    // mappingCard.appendChild(fieldKeySection);

    // Add card to container
    mappingContainer.appendChild(mappingCard);
  });

  // After the loop that creates mapping cards, add the submit button
  const submitButton = document.createElement("button");
  submitButton.id = "submitMapping";
  submitButton.className = "submit-mapping-btn";
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

    // Disable the button and show loading state
    submitButton.disabled = true;
    submitButton.textContent = "Submitting..."; // Change button text to indicate loading

    try {
      // Make a POST request to the API
      const response = await fetch("http://localhost:3002/crm_form_fillers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mappingData), // Send the mapping data in the body
      });

      const result = await response.json(); // Parse the JSON response

      if (response.ok) {
        // Close the "Create Mapping by Default" cards
        document.getElementById("mappingContainer").style.display = "none"; // Hides the button
        // Show success message
        displayMsg("Mapping saved successfully!");

        // New code to display the response data in a table
        displayResponseTable(result.data);
      } else {
        displayMsg(
          "Error saving mapping data: " + (result.error || "Unknown error")
        );
      }
    } catch (error) {
      displayMsg("Error sending message: " + error.message);
    } finally {
      // Re-enable the button and reset text after the request completes
      submitButton.disabled = false;
      submitButton.textContent = "Submit Mapping"; // Reset button text
    }
  });

  mappingContainer.appendChild(submitButton);

  // Add styling
  const style = document.createElement("style");
  style.textContent = `
        .mapping-card {
            background: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 40px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            position: relative;
            width: 100%;
            box-sizing: border-box;
        }
        
        .mapping-section {
            margin-bottom: 15px;
            width: 100%;
        }
        
        .mapping-section:last-child {
            margin-bottom: 0;
        }
        
        .mapping-section label {
            display: block;
            font-weight: bold;
            margin-bottom: 5px;
            color: #333;
        }
        
        .mapping-section input,
        .record-keybind-btn {
            width: 100%;
            box-sizing: border-box;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
        }
        
        .mapping-section input:focus {
            outline: none;
            border-color: #007bff;
            box-shadow: 0 0 0 2px rgba(0,123,255,0.25);
        }
        
        .field-key-input,
        .field-name-input,
        .reference-input {
            background-color: #e9ecef;
            cursor: pointer !important;
        }
        
        #mappingContainer {
            padding: 15px;
            max-height: 65vh;
            overflow-y: auto;
        }
        
        .button-container {
            position: absolute;
            top: 10px;
            right: 10px;
            display: flex;
            gap: 5px;
        }
        
        .mapping-card {
            position: relative;
            /* ... existing mapping-card styles ... */
        }
        
        .mapping-btn {
            width: 24px;
            height: 24px;
            border-radius: 12px;
            border: none;
            color: white;
            font-size: 18px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            line-height: 1;
        }
        
        .add-btn {
            background-color: #28a745;
        }
        
        .remove-btn {
            background-color: #dc3545;
        }
        
        .mapping-btn:hover {
            opacity: 0.8;
        }
        
        .submit-mapping-btn {
            background-color: #007bff;
            color: white;
            padding: 10px 20px;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            margin-top: 20px;
            width: 100%;
            max-width: 400px;
        }

        .submit-mapping-btn:hover {
            background-color: #0056b3;
        }
        
        .field-name-input {
            background-color: white !important;
            cursor: text !important;
            padding-right: 30px !important;
        }
        
        .example-input {
            background-color: #e9ecef !important;
            cursor: not-allowed !important;
            color: #6c757d !important;
        }
        
        .example-input::placeholder {
            color: #6c757d;
        }
        
        .field-name-wrapper {
            position: relative;
            width: 100%;
        }

        .field-name-input {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
            background-color: #fff;
            cursor: pointer;
            box-sizing: border-box;
            background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
            background-repeat: no-repeat;
            background-position: right 10px center;
            background-size: 1em;
        }

        .dropdown-list {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            width: 100%;
            background: white;
            border: 1px solid #ddd;
            border-radius: 5px;
            margin-top: 5px;
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            box-sizing: border-box;
            display: block;
            visibility: hidden;
            opacity: 0;
            transition: visibility 0s, opacity 0.2s;
        }

        .dropdown-list:not(.hidden) {
            visibility: visible;
            opacity: 1;
        }

        .dropdown-option {
            padding: 10px;
            cursor: pointer;
            font-size: 14px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .dropdown-option:hover {
            background-color: #f5f5f5;
        }

        .mapping-card {
            margin-bottom: 40px; /* Increased to prevent overlap */
        }
    `;
  document.head.appendChild(style);

  // Add this new CSS to your existing styles
  const additionalStyles = `
        .provider-wrapper {
            position: relative;
            width: 100%;
            margin-bottom: 20px;
        }

        .provider-input {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
            background-color: #fff;
            cursor: pointer;
            box-sizing: border-box;
            background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
            background-repeat: no-repeat;
            background-position: right 10px center;
            background-size: 1em;
        }

        .provider-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            width: 100%;
            background: white;
            border: 1px solid #ddd;
            border-radius: 5px;
            margin-top: 5px;
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            box-sizing: border-box;
            display: block;
            visibility: hidden;
            opacity: 0;
            transition: visibility 0s, opacity 0.2s;
        }

        .provider-dropdown:not(.hidden) {
            display: block;
        }

        .provider-option {
            padding: 10px;
            cursor: pointer;
            font-size: 14px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .provider-option:hover {
            background-color: #f5f5f5;
        }
    `;

  // Add the styles to the document
  const styleElement = document.createElement("style");
  styleElement.textContent = additionalStyles;
  document.head.appendChild(styleElement);
}

// Add this function to fetch providers
async function fetchProviders() {
  let loader; // Declare loader in a higher scope
  try {
    let allProviders = [];
    let page = 1;
    let hasMoreData = true;
    const pageSize = 100; // Increased page size to reduce number of requests

    // Show loader before starting the fetch
    loader = document.createElement("div");
    loader.className = "loader";
    loader.innerHTML = `<div class="spinner"></div>`;
    document.body.appendChild(loader);

    while (hasMoreData) {
      const response = await fetch(
        `https://base.amberstudent.com/providers?p=${page}&limit=${pageSize}&sort_key=created&sort_order=desc&type=all`
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
    // After fetching is complete, remove the loader
    if (loader) {
      document.body.removeChild(loader);
    }
  }
}

// Update the DOMContentLoaded event listener
document.addEventListener("DOMContentLoaded", async function () {
  // Fetch providers first
  const providers = await fetchProviders();

  const containerDiv = document.createElement("div");
  const providerWrapper = document.createElement("div");
  providerWrapper.className = "provider-wrapper";

  const providerInput = document.createElement("input");
  providerInput.type = "text";
  providerInput.className = "provider-input";
  providerInput.placeholder = "Search providers...";
  // providerInput.readOnly = true;

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

  // Toggle dropdown on input click
  providerInput.onclick = (e) => {
    e.stopPropagation();
    providerDropdown.classList.toggle("hidden");
  };

  // Close dropdown when clicking outside
  document.addEventListener("click", () => {
    providerDropdown.classList.add("hidden");
  });

  // Add provider options from API response
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

      // Clear feedback when a provider is selected
      showFeedback("");
      feedback.style.display = "none";
    };
    providerDropdown.appendChild(option);
  });

  // Assemble the dropdown
  providerWrapper.appendChild(providerInput);
  providerWrapper.appendChild(providerDropdown);
  containerDiv.appendChild(providerWrapper);

  // Replace the original select with the new custom dropdown
  providerSelect.parentNode.replaceChild(containerDiv, providerSelect);

  // Add styles
  const styles = `
        .provider-wrapper {
            position: relative;
            width: 100%;
            margin-bottom: 20px;
        }

        .provider-input {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 16px;
            background-color: #fff;
            cursor: pointer;
            box-sizing: border-box;
            background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
            background-repeat: no-repeat;
            background-position: right 10px center;
            background-size: 1em;
        }

        .provider-input::placeholder {
            color: #666;
        }

        .provider-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            width: 100%;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            margin-top: 5px;
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            box-sizing: border-box;
            display: none;
        }

        .provider-dropdown:not(.hidden) {
            display: block;
        }

        .provider-option {
            padding: 12px;
            cursor: pointer;
            font-size: 16px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .provider-option:hover {
            background-color: #f5f5f5;
        }

        .provider-option:first-child {
            border-radius: 8px 8px 0 0;
        }

        .provider-option:last-child {
            border-radius: 0 0 8px 8px;
        }
    `;

  const styleElement = document.createElement("style");
  styleElement.textContent = styles;
  document.head.appendChild(styleElement);

  const createMappingButton = document.getElementById("createDefaultMapping");
  const fetchCRMButton = document.getElementById("fetchCRMData");

  // Show/hide create mapping button based on provider selection
  providerInput.addEventListener("change", function () {
    if (this.value) {
      createMappingButton.style.display = "block";
    } else {
      createMappingButton.style.display = "none";
    }
  });

  if (createMappingButton) {
    createMappingButton.addEventListener("click", () => {
      const mappingContainer = document.getElementById("mappingContainer");

      // Toggle mapping container visibility
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
      const keyValueTableContainer = document.getElementById("keyValueTableContainer");
      const responseTableContainer = document.getElementById("responseTableContainer");

      // Toggle CRM data inputs visibility
      if (crmDataInputs) {
        if (
          crmDataInputs.style.display === "none" ||
          !crmDataInputs.style.display
        ) {
          if (!isDataLoaded) {
            submitFormId(); // Only fetch data if it hasn't been loaded yet
            isDataLoaded = true; // Set the flag to true after loading data
          }
          crmDataInputs.style.display = "block";
          if (keyValueTableContainer) {
            keyValueTableContainer.style.display = "block"; // Show the key-value table when fetching CRM data
          }
          // Hide the response table
          if (responseTableContainer) {
            responseTableContainer.style.display = "none"; // Hide the response table
            isResponseTableVisible = false; // Update visibility state
          }
        } else {
          crmDataInputs.style.display = "none";
          if (keyValueTableContainer) {
            keyValueTableContainer.style.display = "none"; // Hide the key-value table when closing the inputs
          }
          // Show the response table again when closing the button
          if (responseTableContainer) {
            responseTableContainer.style.display = "block"; // Show the response table
            isResponseTableVisible = true; // Update visibility state
          }
        }
      }
    });
  }

  const submitButton = document.getElementById("submitFormId");
  if (submitButton) {
    submitButton.addEventListener("click", submitFormId);
  }
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
// Add this function at the top level
function startRecordingKeybind(referenceInput, recordButton) {
  recordButton.classList.add("recording");
  recordButton.style.backgroundColor = "red";

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

            // Add click handler for highlighting after recording
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
  // Reset button state
  recordButton.classList.remove("recording");
  recordButton.style.backgroundColor = "";
}

// Add this CSS to your existing styles
const additionalStyles = `
    #providerSelect {
        width: 100%;
        margin: 8px 0;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
        background-color: white;
        cursor: pointer;
        margin-bottom: 15px;
    }

    #providerSelect:focus {
        outline: none;
        border-color: #007aff;
    }
`;

document
  .getElementById("providerSelect")
  .addEventListener("change", function () {
    const fetchCRMButton = document.getElementById("fetchCRMData");
    fetchCRMButton.style.display = this.value ? "block" : "none";
  });

// New function to display the response data in a table
function displayResponseTable(data) {
  // Create or get the table container
  let tableContainer = document.getElementById("responseTableContainer");
  if (!tableContainer) {
    tableContainer = document.createElement("div");
    tableContainer.id = "responseTableContainer";
    document.body.appendChild(tableContainer);
  }

  // Clear previous content
  tableContainer.innerHTML = '';

  // Assuming the provider name and ID are the same for all entries
  const providerName =
    data.length > 0 ? data[0].provider_name : "Unknown Provider";
  const providerId = data.length > 0 ? data[0].provider_id : "Unknown ID";

  // Create a header for provider name and ID
  const providerInfo = document.createElement("div");
  providerInfo.className = "provider-info";
  providerInfo.innerHTML = `<strong>Provider Name:</strong> ${providerName} <br> <strong>Provider ID:</strong> ${providerId}`;
  tableContainer.appendChild(providerInfo);

  // Create a wrapper for the table to enable scrolling
  const tableWrapper = document.createElement("div");
  tableWrapper.className = "table-wrapper"; // New wrapper class
  tableContainer.appendChild(tableWrapper);

  const table = document.createElement("table");
  table.className = "response-table";

  // Create table header
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

  // Create table rows for each data entry
  data.forEach((item) => {
    // Check if the "Value of the Field" is not empty
    if (item.value_of_the_field) { // Only create a row if the value is not empty
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

  // Append the table to the wrapper
  tableWrapper.appendChild(table);

  document.body.appendChild(tableContainer);

  // Add CSS for table wrapper to enable scrolling
  const style = document.createElement("style");
  style.textContent = `
        .table-wrapper {
            max-width: 100%; /* Set a max width for the table */
            overflow-x: auto; /* Enable horizontal scrolling */
            margin-top: 20px; /* Add some space above the table */
        }

        .response-table {
            width: 100%; /* Ensure the table takes full width of the wrapper */
            border-collapse: collapse;
        }

        .response-table th, .response-table td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }

        .response-table th {
            background-color: #f2f2f2;
            font-weight: bold;
        }

        .response-table tr:nth-child(even) {
            background-color: #f9f9f9;
        }

        .response-table tr:hover {
            background-color: #f1f1f1;
        }

        .provider-info {
            font-size: 16px;
            margin-bottom: 10px;
            padding-top: 20px;
        }
    `;
  document.head.appendChild(style);
}

// New function to display the key-value pairs in a table
function displayKeyValueTable(key, value) {
  // Hide the response table if it is visible
  const responseTableContainer = document.getElementById("responseTableContainer");
  if (responseTableContainer && isResponseTableVisible) {
    responseTableContainer.style.display = "none"; // Hide the response table
    isResponseTableVisible = false; // Update visibility state
  }

  // Check if the table already exists
  let tableContainer = document.getElementById("keyValueTableContainer");
  if (!tableContainer) {
    tableContainer = document.createElement("div");
    tableContainer.id = "keyValueTableContainer";
    document.body.appendChild(tableContainer);

    // Create the table
    const table = document.createElement("table");
    table.className = "key-value-table";

    // Create table header
    const headerRow = document.createElement("tr");
    const headers = ["Key", "Value"];
    headers.forEach((headerText) => {
      const header = document.createElement("th");
      header.textContent = headerText;
      headerRow.appendChild(header);
    });
    table.appendChild(headerRow);
    tableContainer.appendChild(table);
  }

  // Add or update the row for the key-value pair
  const table = tableContainer.querySelector("table");
  const existingRow = Array.from(table.querySelectorAll("tr")).slice(1).find(row => row.cells[0].textContent === key); // Find existing row by key

  if (value) { // Check if value is present
    if (existingRow) {
      // If the key exists, update the value
      existingRow.cells[1].textContent = value; // Update the value cell
    } else {
      // If the key does not exist, add a new row
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
    // If the value is not present and the row exists, remove the row
    table.deleteRow(existingRow.rowIndex);
  }
  
  // Add CSS for the table
  const style = document.createElement("style");
  style.textContent = `
        .key-value-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }

        .key-value-table th, .key-value-table td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }

        .key-value-table th {
            background-color: #f2f2f2;
            font-weight: bold;
        }

        .key-value-table tr:nth-child(even) {
            background-color: #f9f9f9;
        }

        .key-value-table tr:hover {
            background-color: #f1f1f1;
        }
    `;
  document.head.appendChild(style);
}
