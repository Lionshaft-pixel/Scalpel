// Get all the elements from the HTML we need to control
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.querySelector('.browse-btn');
const optionsSection = document.getElementById('optionsSection');
const baseNameInput = document.getElementById('baseName');
const addNumberingCheckbox = document.getElementById('addNumbering');
const processBtn = document.getElementById('processBtn');
const previewArea = document.getElementById('previewArea');
const downloadSection = document.getElementById('downloadSection');

// This array will hold the files the user selects
let selectedFiles = [];

// 1. MAKE THE "BROWSE FILES" BUTTON WORK
// When the browse button is clicked, simulate a click on the hidden file input
browseBtn.addEventListener('click', () => {
    fileInput.click(); // This triggers the file selection dialog
});

// 2. MAKE THE HIDDEN FILE INPUT WORK
// When a user selects files via the dialog, handle them
fileInput.addEventListener('change', (event) => {
    // Get the selected files and store them
    selectedFiles = Array.from(event.target.files);
    handleFiles(selectedFiles);
});

// 3. MAKE DRAG-AND-DROP WORK
// Prevent default behavior to allow dropping
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
});

// Highlight the drop zone when a file is dragged over it
['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, highlight, false);
});
['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, unhighlight, false);
});

// Handle the dropped files
dropZone.addEventListener('drop', handleDrop, false);

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight() {
    dropZone.classList.add('dragover'); // Adds the highlight style from our CSS
}

function unhighlight() {
    dropZone.classList.remove('dragover');
}

function handleDrop(e) {
    // Get the files from the drop event
    const dt = e.dataTransfer;
    selectedFiles = Array.from(dt.files);
    handleFiles(selectedFiles);
}

// 4. THE MAIN FUNCTION THAT RUNS WHEN FILES ARE SELECTED (by any method)
function handleFiles(files) {
    if (files.length === 0) return;

    // Show the options section now that we have files
    optionsSection.style.display = 'block';

    // Generate a preview of what the new names will be
    updatePreview();

    // Listen for changes in the input fields to update the preview
    baseNameInput.addEventListener('input', updatePreview);
    addNumberingCheckbox.addEventListener('change', updatePreview);
}

// 5. UPDATE THE PREVIEW OF NEW FILENAMES
function updatePreview() {
    const baseName = baseNameInput.value || 'file'; // Use 'file' if nothing is typed
    const addNumbering = addNumberingCheckbox.checked;

    let previewHTML = '<strong>New Names Preview:</strong><br>';
    selectedFiles.forEach((file, index) => {
        let newName = baseName;
        if (addNumbering) {
            // Add numbering like _01, _02
            const number = (index + 1).toString().padStart(2, '0'); // makes 1 -> "01"
            newName += `_${number}`;
        }
        // Keep the original file extension (e.g., .jpg, .pdf)
        const extension = file.name.split('.').pop();
        newName += `.${extension}`;

        // Show the change: oldname.txt -> newname_01.txt
        previewHTML += `${file.name} <strong>→</strong> ${newName}<br>`;
    });
    previewArea.innerHTML = previewHTML;
}

// 6. MAKE THE "PROCESS & DOWNLOAD" BUTTON WORK
// This is the final, main function that does the renaming and gives the user a ZIP
processBtn.addEventListener('click', async () => {
    // We will write this function in the NEXT STEP.
    // For now, let's just check that it's connected.
    console.log("Process button was clicked!");
    alert("The Process button is connected. The renaming logic will go here in the next step.");
});