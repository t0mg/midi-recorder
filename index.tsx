import { Midi } from "@tonejs/midi";

const LOCAL_STORAGE_KEY = "midiRecordings";
const AUTO_RECORD_KEY = "autoRecordSetting";
const OUTPUT_CHANNEL_KEY = "outputChannelSetting";

type MidiEvent = {
  data: number[];
  timestamp: number;
};

// --- STATE ---
let midiAccess: MIDIAccess | null = null;
let inputs: MIDIInput[] = [];
let outputs: MIDIOutput[] = [];
let selectedInputId: string | null = null;
let selectedOutputId: string | null = null;
let selectedOutputChannel: string = "default";

let isRecording = false;
let isPlaying = false;
let playbackStartTime = 0;

let currentRecording: MidiEvent[] = [];
let recordingStartTime = 0;
let currentLoadedName: string | null = null;

let playbackChunkTimeoutId: number | null = null;
let playbackVisualTimeoutIds: number[] = [];
let playbackSeekOffset = 0;
let totalDuration = 0;
let playbackUpdateIntervalId: number | null = null;


let savedRecordings: Record<string, MidiEvent[]> = {};
let selectedRecordingName: string | null = null;

// Auto-record state
let isAutoRecordMode = true;
let silenceTimeoutId: number | null = null;
const PRE_RECORD_BUFFER_DURATION = 500; // 500ms pre-roll buffer
let preRecordBuffer: { data: number[], timestamp: number }[] = [];

// Screen Wake Lock
let wakeLockSentinel: any | null = null;


// --- DOM ELEMENTS ---
const statusEl = document.getElementById("status-bar")!;
const midiIndicator = document.getElementById("midi-indicator")!;
const toggleDevicesButton = document.getElementById("toggle-devices-button") as HTMLButtonElement;
const deviceSettingsTitle = document.getElementById("device-settings-title") as HTMLSpanElement;
const deviceStatusLed = document.getElementById("device-status-led") as HTMLSpanElement;
const deviceSelectorsContainer = document.getElementById("device-selectors-container")!;
const inputSelector = document.getElementById("midi-input") as HTMLSelectElement;
const outputSelector = document.getElementById("midi-output") as HTMLSelectElement;
const outputChannelSelector = document.getElementById("output-channel") as HTMLSelectElement;
const recordButton = document.getElementById("record-button") as HTMLButtonElement;
const playButton = document.getElementById("play-button") as HTMLButtonElement;
const saveButton = document.getElementById("save-button") as HTMLButtonElement;
const exportButton = document.getElementById("export-button") as HTMLButtonElement;
const importInput = document.getElementById("import-midi-input") as HTMLInputElement;
const savedRecordingsSelector = document.getElementById("saved-recordings") as HTMLSelectElement;
const loadButton = document.getElementById("load-button") as HTMLButtonElement;
const renameButton = document.getElementById("rename-button") as HTMLButtonElement;
const deleteButton = document.getElementById("delete-button") as HTMLButtonElement;
const playbackCard = document.getElementById("playback-card")!;
const timeDisplay = document.getElementById("time-display")!;
const playbackSlider = document.getElementById("playback-slider") as HTMLInputElement;
const autoRecordCheckbox = document.getElementById("auto-record-checkbox") as HTMLInputElement;

// --- UI UPDATE FUNCTIONS ---

function updateStatus(text: string) {
    statusEl.textContent = text;
}

function flashIndicator() {
    midiIndicator.classList.add("active");
    setTimeout(() => {
        midiIndicator.classList.remove("active");
    }, 150);
}

function updateDeviceStatusIndicator() {
    const hasValidInput = selectedInputId && inputs.some(i => i.id === selectedInputId);
    if (hasValidInput) {
        deviceStatusLed.classList.add('connected');
        deviceStatusLed.classList.remove('disconnected');
    } else {
        deviceStatusLed.classList.add('disconnected');
        deviceStatusLed.classList.remove('connected');
    }
}

function updateDeviceLists() {
    const currentInput = selectedInputId;
    const currentOutput = selectedOutputId;

    // Inputs
    inputSelector.innerHTML = '';
    if (inputs.length === 0) {
        inputSelector.innerHTML = '<option value="">No input devices found</option>';
    } else {
        inputSelector.innerHTML = '<option value="">Select an input...</option>';
        inputs.forEach(input => {
            const option = document.createElement('option');
            option.value = input.id;
            option.textContent = input.name ?? 'Unknown Input';
            inputSelector.appendChild(option);
        });
    }
    inputSelector.value = currentInput ?? '';

    // Outputs
    outputSelector.innerHTML = '';
    if (outputs.length === 0) {
         outputSelector.innerHTML = '<option value="">No output devices found</option>';
    } else {
        outputSelector.innerHTML = '<option value="">Select an output...</option>';
        outputs.forEach(output => {
            const option = document.createElement('option');
            option.value = output.id;
            option.textContent = output.name ?? 'Unknown Output';
            outputSelector.appendChild(option);
        });
    }
    outputSelector.value = currentOutput ?? '';

    updateDeviceStatusIndicator();
    updateButtonStates();
}

function updateSavedRecordingsList() {
    savedRecordingsSelector.innerHTML = '';
    const names = Object.keys(savedRecordings);
    if (names.length === 0) {
        savedRecordingsSelector.innerHTML = '<option>No saved recordings</option>';
    }
    names.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        savedRecordingsSelector.appendChild(option);
    });

    if (selectedRecordingName && savedRecordings[selectedRecordingName]) {
        savedRecordingsSelector.value = selectedRecordingName;
    } else if (names.length > 0) {
        selectedRecordingName = names[0];
        savedRecordingsSelector.value = selectedRecordingName;
    } else {
        selectedRecordingName = null;
    }
    updateButtonStates();
}

function updateButtonStates() {
    const hasNoteOn = currentRecording.some(event => {
        // Check for a "Note On" message (status 0x90) with velocity > 0
        return event.data.length === 3 && (event.data[0] & 0xF0) === 0x90 && event.data[2] > 0;
    });

    const hasValidInput = selectedInputId && inputs.some(i => i.id === selectedInputId);
    recordButton.disabled = isPlaying || !hasValidInput || isAutoRecordMode;
    playButton.disabled = isRecording || !hasNoteOn;

    saveButton.disabled = isRecording || isPlaying || !hasNoteOn || isAutoRecordMode;
    exportButton.disabled = isRecording || isPlaying || !hasNoteOn;

    loadButton.disabled = isRecording || isPlaying || !selectedRecordingName;
    renameButton.disabled = isRecording || isPlaying || !selectedRecordingName;
    deleteButton.disabled = isRecording || isPlaying || !selectedRecordingName;

    if (isRecording) {
        recordButton.classList.add('recording');
        recordButton.textContent = 'Stop';
    } else {
        recordButton.classList.remove('recording');
        recordButton.textContent = 'Record';
    }

    if (isPlaying) {
        playButton.classList.add('playing');
        playButton.textContent = 'Stop';
    } else {
        playButton.classList.remove('playing');
        playButton.textContent = 'Play';
    }

    playbackCard.style.display = hasNoteOn ? 'block' : 'none';
}


function formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}


function updatePlaybackUI() {
    if (!isPlaying) {
        if (playbackUpdateIntervalId) clearInterval(playbackUpdateIntervalId);
        playbackUpdateIntervalId = null;
        return;
    }
    const elapsedTime = (performance.now() - playbackStartTime + playbackSeekOffset) / 1000;
    const currentPos = Math.min(elapsedTime, totalDuration);
    playbackSlider.value = String(totalDuration > 0 ? (currentPos / totalDuration) * 100 : 0);
    timeDisplay.textContent = `${formatTime(currentPos)} / ${formatTime(totalDuration)}`;

    if (currentPos >= totalDuration && totalDuration > 0) {
        stopPlayback();
    }
}

// --- PLAYBACK LOGIC ---

function startPlayback() {
    if (isPlaying || currentRecording.length === 0) return;

    const output = outputs.find(o => o.id === selectedOutputId);
    if (!output) {
        updateStatus("Error: No output device selected for playback.");
        return;
    }

    isPlaying = true;
    playbackStartTime = performance.now();
    updateStatus(`Playing back recording: ${currentLoadedName ?? "Current Recording"}`);
    updateButtonStates();
    requestWakeLock();


    if (playbackUpdateIntervalId) clearInterval(playbackUpdateIntervalId);
    playbackUpdateIntervalId = setInterval(updatePlaybackUI, 100);

    const firstEventTime = currentRecording[0].timestamp;
    totalDuration = (currentRecording[currentRecording.length - 1].timestamp - firstEventTime) / 1000;

    const playChunk = (startIndex: number) => {
        if (!isPlaying) return;

        for (let i = startIndex; i < currentRecording.length; i++) {
            const event = currentRecording[i];
            const eventTime = event.timestamp - firstEventTime;

            if (eventTime < playbackSeekOffset) continue;

            const delay = eventTime - (performance.now() - playbackStartTime + playbackSeekOffset);

            if (delay > 20) { // Schedule next chunk if delay is significant
                playbackChunkTimeoutId = setTimeout(() => playChunk(i), 20);
                return;
            }
            
            const [status, data1, data2] = event.data;
            if (status >= 0xF0) {
                continue;
            }
            let finalMessage;
            if (selectedOutputChannel !== 'default') {
                const newStatus = (status & 0xF0) | (parseInt(selectedOutputChannel, 10) - 1);
                finalMessage = [newStatus, data1, data2];
            } else {
                finalMessage = [status, data1, data2];
            }
            
            output.send(finalMessage);

             if ((status & 0xF0) === 0x90 && data2 > 0) {
                 flashIndicator();
             }
        }
    };
    
    playChunk(0);
}


function stopPlayback(seek = false) {
    if (!isPlaying) return;

    isPlaying = false;
    if (playbackChunkTimeoutId) {
        clearTimeout(playbackChunkTimeoutId);
        playbackChunkTimeoutId = null;
    }
    playbackVisualTimeoutIds.forEach(clearTimeout);
    playbackVisualTimeoutIds = [];
    if (playbackUpdateIntervalId) {
        clearInterval(playbackUpdateIntervalId);
        playbackUpdateIntervalId = null;
    }

    const output = outputs.find(o => o.id === selectedOutputId);
    if (output) {
        for (let channel = 0; channel < 16; channel++) {
            output.send([0xB0 + channel, 123, 0]); // All Notes Off
        }
    }
    
    if (!seek) {
      playbackSeekOffset = 0;
      updatePlaybackUI();
      playbackSlider.value = '0';
      timeDisplay.textContent = `${formatTime(0)} / ${formatTime(totalDuration)}`;
    }
    
    updateStatus("Playback stopped.");
    updateButtonStates();
    releaseWakeLock();
}

function seekPlayback(value: number) {
    if (currentRecording.length === 0) return;
    const wasPlaying = isPlaying;
    if (wasPlaying) {
        stopPlayback(true);
    }
    const firstEventTime = currentRecording[0].timestamp;
    totalDuration = (currentRecording[currentRecording.length - 1].timestamp - firstEventTime) / 1000;
    playbackSeekOffset = (totalDuration * value / 100) * 1000;
    
    const elapsedTime = playbackSeekOffset / 1000;
    timeDisplay.textContent = `${formatTime(elapsedTime)} / ${formatTime(totalDuration)}`;

    if(wasPlaying){
        startPlayback();
    }
}


// --- RECORDING LOGIC ---

function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    if (isRecording || !selectedInputId) return;

    currentRecording = [];
    currentLoadedName = null;
    isRecording = true;
    recordingStartTime = performance.now();
    updateStatus("Recording...");
    updateButtonStates();
    requestWakeLock();
    
    totalDuration = 0;
    playbackSeekOffset = 0;
    playbackSlider.value = '0';
    timeDisplay.textContent = '00:00 / 00:00';
}

function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    
    // Normalize timestamps
    if(currentRecording.length > 0) {
        const firstTimestamp = currentRecording[0].timestamp;
        currentRecording.forEach(event => event.timestamp -= firstTimestamp);
        totalDuration = currentRecording[currentRecording.length-1].timestamp / 1000;
    } else {
        totalDuration = 0;
    }

    updateStatus(`Recording finished. Length: ${totalDuration.toFixed(1)}s.`);
    updateButtonStates();
    releaseWakeLock();
    timeDisplay.textContent = `${formatTime(0)} / ${formatTime(totalDuration)}`;
}


// --- DATA MANAGEMENT ---

function saveRecording() {
    if (currentRecording.length === 0) {
        updateStatus("Nothing to save.");
        return;
    }
    const name = prompt("Enter a name for this recording:", currentLoadedName ?? `Recording ${new Date().toLocaleString()}`);
    if (name) {
        savedRecordings[name] = [...currentRecording];
        currentLoadedName = name;
        selectedRecordingName = name;
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(savedRecordings));
        updateStatus(`Recording saved as "${name}".`);
        updateSavedRecordingsList();
    }
}

function autoSaveRecording() {
    if (currentRecording.length === 0) {
        return;
    }
    const name = `Auto-recording ${new Date().toLocaleString()}`;
    savedRecordings[name] = [...currentRecording];
    currentLoadedName = name;
    selectedRecordingName = name;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(savedRecordings));
    updateStatus(`Recording auto-saved as "${name}".`);
    updateSavedRecordingsList();
}

function loadRecording() {
    if (isRecording) return;
    const name = savedRecordingsSelector.value;
    if (name && savedRecordings[name]) {
        stopPlayback();
        currentRecording = [...savedRecordings[name]];
        currentLoadedName = name;
        selectedRecordingName = name;
        updateStatus(`Loaded recording: "${name}".`);
        if (currentRecording.length > 0) {
            totalDuration = currentRecording[currentRecording.length-1].timestamp / 1000;
        } else {
            totalDuration = 0;
        }
        playbackSeekOffset = 0;
        playbackSlider.value = '0';
        timeDisplay.textContent = `${formatTime(0)} / ${formatTime(totalDuration)}`;
        updateButtonStates();
    }
}

function renameRecording() {
    const oldName = selectedRecordingName;
    if (!oldName || !savedRecordings[oldName]) {
        updateStatus("No recording selected to rename.");
        return;
    }

    const newName = prompt(`Enter a new name for "${oldName}":`, oldName);

    if (newName && newName !== oldName) {
        if (savedRecordings[newName]) {
            updateStatus(`Error: A recording named "${newName}" already exists.`);
            return;
        }

        savedRecordings[newName] = savedRecordings[oldName];
        delete savedRecordings[oldName];

        selectedRecordingName = newName;
        if (currentLoadedName === oldName) {
            currentLoadedName = newName;
        }

        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(savedRecordings));
        updateStatus(`Renamed "${oldName}" to "${newName}".`);
        updateSavedRecordingsList();
    }
}

function deleteRecording() {
    const name = savedRecordingsSelector.value;
    if (name && savedRecordings[name]) {
        if (confirm(`Are you sure you want to delete "${name}"?`)) {
            delete savedRecordings[name];
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(savedRecordings));
            updateStatus(`Deleted recording: "${name}".`);
            
            if (currentLoadedName === name) {
                currentRecording = [];
                currentLoadedName = null;
                totalDuration = 0;
                timeDisplay.textContent = '00:00 / 00:00';
                playbackSlider.value = '0';
            }

            selectedRecordingName = null;
            updateSavedRecordingsList();
        }
    }
}


function exportMIDI() {
    if (currentRecording.length === 0) {
        updateStatus("No recording to export.");
        return;
    }

    try {
        const midi = new Midi();
        const track = midi.addTrack();
        
        if (currentRecording.length > 0) {
            let lastTimestamp = 0;
            currentRecording.forEach(event => {
                const [status, data1, data2] = event.data;
                const messageType = status & 0xF0;
                const deltaTime = (event.timestamp - lastTimestamp) / 1000;
                
                switch (messageType) {
                    case 0x90: // Note On
                         track.addNote({
                            midi: data1,
                            time: deltaTime,
                            velocity: data2 / 127,
                            duration: 0 // Duration will be determined by a matching note-off
                        });
                        break;
                    case 0x80: // Note Off
                        track.addNote({
                            midi: data1,
                            time: deltaTime,
                            velocity: 0,
                            duration: 0
                        });
                        break;
                    case 0xB0: // Control Change
                        track.addCC({
                            number: data1,
                            value: data2 / 127,
                            time: deltaTime,
                        });
                        break;
                }
                 lastTimestamp = event.timestamp;
            });
        }

        const midiArray = midi.toArray();
        const blob = new Blob([midiArray], { type: "audio/midi" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const filename = currentLoadedName ? `${currentLoadedName}.mid` : `midi-recording-${Date.now()}.mid`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        updateStatus(`Exported as ${filename}`);
    } catch (e) {
        console.error("Failed to export MIDI:", e);
        updateStatus("Error: Failed to export MIDI file.");
    }
}


async function importMIDI(file: File) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const midi = new Midi(arrayBuffer);
        
        if (midi.tracks.length === 0) {
            updateStatus("Error: MIDI file has no tracks.");
            return;
        }
        
        stopPlayback();
        currentRecording = [];
        
        let allNotes: any[] = [];
        midi.tracks.forEach(track => {
            track.notes.forEach(note => {
                allNotes.push({
                    ...note,
                    startTime: note.time,
                    endTime: note.time + note.duration
                });
            });
        });
        
        allNotes.sort((a,b) => a.startTime - b.startTime);

        allNotes.forEach(note => {
             currentRecording.push({
                data: [0x90 | note.channel, note.midi, Math.round(note.velocity * 127)],
                timestamp: note.startTime * 1000,
            });
             currentRecording.push({
                data: [0x80 | note.channel, note.midi, 0],
                timestamp: note.endTime * 1000,
            });
        });
        
        currentRecording.sort((a, b) => a.timestamp - b.timestamp);

        if (currentRecording.length > 0) {
            totalDuration = currentRecording[currentRecording.length-1].timestamp / 1000;
        } else {
            totalDuration = 0;
        }
        
        currentLoadedName = file.name.replace(/\.(mid|midi)$/i, '');
        updateStatus(`Imported: ${file.name}`);
        updateButtonStates();
        
        playbackSeekOffset = 0;
        playbackSlider.value = '0';
        timeDisplay.textContent = `${formatTime(0)} / ${formatTime(totalDuration)}`;

    } catch (e) {
        console.error("Failed to import MIDI:", e);
        updateStatus("Error: Could not parse MIDI file.");
    }
}


// --- MIDI & DEVICE SETUP ---
function onMIDISuccess(access: MIDIAccess) {
    midiAccess = access;
    midiAccess.onstatechange = onStateChange;
    updateStatus("MIDI ready. Select input/output devices.");
    initMidiDevices();
}

function onMIDIFailure(msg: string) {
    updateStatus(`Failed to get MIDI access - ${msg}`);
    console.error(`Failed to get MIDI access - ${msg}`);
}

function onStateChange() {
    initMidiDevices();
}


function initMidiDevices() {
    if (!midiAccess) return;
    
    inputs = Array.from(midiAccess.inputs.values());
    outputs = Array.from(midiAccess.outputs.values());
    
    if (selectedInputId && !inputs.some(i => i.id === selectedInputId)) {
        selectedInputId = null;
    }
    if (selectedOutputId && !outputs.some(o => o.id === selectedOutputId)) {
        selectedOutputId = null;
    }
    
    if (!selectedInputId && inputs.length > 0) {
        selectedInputId = inputs[0].id;
    }
    if (!selectedOutputId && outputs.length > 0) {
        selectedOutputId = outputs[0].id;
    }

    updateDeviceLists();
    attachMIDIMessageListener();
}

function attachMIDIMessageListener() {
    if (!midiAccess) return;
    inputs.forEach(input => {
        input.onmidimessage = null;
    });

    const input = inputs.find(i => i.id === selectedInputId);
    if (input) {
        updateStatus(`Listening to ${input.name}...`);
        input.onmidimessage = onMIDIMessage;
    } else {
        updateStatus("No input device selected.");
    }
}

function onMIDIMessage(message: MIDIMessageEvent) {
    const eventData = Array.from(message.data);
    const [status, data1, data2] = eventData;
    
    const output = outputs.find(o => o.id === selectedOutputId);
    if (output) {
         let finalMessage;
         if (selectedOutputChannel !== 'default') {
             const newStatus = (status & 0xF0) | (parseInt(selectedOutputChannel, 10) - 1);
             finalMessage = [newStatus, data1, data2];
         } else {
             finalMessage = eventData;
         }
         output.send(finalMessage);
    }

    const isNoteOn = (status & 0xF0) === 0x90 && data2 > 0;
    const isNoteOff = (status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && data2 === 0);

    if(isNoteOn) {
        flashIndicator();
    }

    if (isAutoRecordMode && isNoteOn && !isRecording) {
        startRecording();
    }
    
    if (isAutoRecordMode && isRecording && (isNoteOn || isNoteOff)) {
        if (silenceTimeoutId) clearTimeout(silenceTimeoutId);
        silenceTimeoutId = setTimeout(() => {
            if (isRecording) {
                updateStatus("Silence detected, stopping auto-record.");
                stopRecording();
                autoSaveRecording();
            }
        }, 3000); // 3 seconds of silence
    }
    
    // Only record channel messages (0x80-0xEF), not system messages (0xF0-0xFF)
    if (status < 0xF0) {
        const timestamp = performance.now();
        preRecordBuffer.push({ data: eventData, timestamp: timestamp });
        while (preRecordBuffer.length > 0 && timestamp - preRecordBuffer[0].timestamp > PRE_RECORD_BUFFER_DURATION) {
            preRecordBuffer.shift();
        }

        if (isRecording) {
            if (currentRecording.length === 0) {
                currentRecording.push(...preRecordBuffer);
                recordingStartTime = preRecordBuffer.length > 0 ? preRecordBuffer[0].timestamp : performance.now();
            }
            currentRecording.push({ data: eventData, timestamp });
        }
    }
}


// --- WAKE LOCK ---
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {});
    } catch (err: any) {
      console.error(`${err.name}, ${err.message}`);
      updateStatus(`Warning: Could not acquire screen wake lock.`);
    }
  }
}

async function releaseWakeLock() {
  if (wakeLockSentinel) {
    await wakeLockSentinel.release();
    wakeLockSentinel = null;
  }
}


// --- INITIALIZATION ---
function setupEventListeners() {
    toggleDevicesButton.addEventListener('click', () => {
        const isExpanded = toggleDevicesButton.getAttribute('aria-expanded') === 'true';
        toggleDevicesButton.setAttribute('aria-expanded', String(!isExpanded));
        deviceSelectorsContainer.classList.toggle('expanded');
    });

    inputSelector.addEventListener('change', () => {
        selectedInputId = inputSelector.value || null;
        attachMIDIMessageListener();
        updateDeviceStatusIndicator();
        updateButtonStates();
    });

    outputSelector.addEventListener('change', () => {
        selectedOutputId = outputSelector.value || null;
    });

    outputChannelSelector.addEventListener('change', () => {
        selectedOutputChannel = outputChannelSelector.value;
        localStorage.setItem(OUTPUT_CHANNEL_KEY, selectedOutputChannel);
    });

    recordButton.addEventListener('click', toggleRecording);
    playButton.addEventListener('click', () => {
        if (isPlaying) {
            stopPlayback();
        } else {
            startPlayback();
        }
    });
    saveButton.addEventListener('click', saveRecording);
    exportButton.addEventListener('click', exportMIDI);

    importInput.addEventListener('change', (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file) {
            importMIDI(file);
            (event.target as HTMLInputElement).value = ''; // Reset input
        }
    });

    savedRecordingsSelector.addEventListener('change', () => {
        selectedRecordingName = savedRecordingsSelector.value;
        updateButtonStates();
    });

    loadButton.addEventListener('click', loadRecording);
    renameButton.addEventListener('click', renameRecording);
    deleteButton.addEventListener('click', deleteRecording);
    
    playbackSlider.addEventListener('input', () => {
        seekPlayback(parseInt(playbackSlider.value, 10));
    });
    
    autoRecordCheckbox.addEventListener('change', () => {
        isAutoRecordMode = autoRecordCheckbox.checked;
        localStorage.setItem(AUTO_RECORD_KEY, JSON.stringify(isAutoRecordMode));
        if (!isAutoRecordMode && silenceTimeoutId) {
            clearTimeout(silenceTimeoutId);
            silenceTimeoutId = null;
        }
        updateButtonStates();
    });
}

function initializeApp() {
    outputChannelSelector.innerHTML = '<option value="default">Default (Passthrough)</option>';
    for (let i = 1; i <= 16; i++) {
        const option = document.createElement('option');
        option.value = String(i-1);
        option.textContent = `Channel ${i}`;
        outputChannelSelector.appendChild(option);
    }
    
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
        try {
            savedRecordings = JSON.parse(saved);
        } catch (e) {
            console.error("Could not parse saved recordings:", e);
        }
    }
    updateSavedRecordingsList();

    deviceSelectorsContainer.classList.remove('expanded');
    toggleDevicesButton.setAttribute('aria-expanded', 'false');

    const savedAutoRecord = localStorage.getItem(AUTO_RECORD_KEY);
    if (savedAutoRecord !== null) {
        isAutoRecordMode = JSON.parse(savedAutoRecord);
        autoRecordCheckbox.checked = isAutoRecordMode;
    }

    const savedOutputChannel = localStorage.getItem(OUTPUT_CHANNEL_KEY);
    if (savedOutputChannel !== null) {
        selectedOutputChannel = savedOutputChannel;
        outputChannelSelector.value = selectedOutputChannel;
    }

    if (navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess({ sysex: false }).then(onMIDISuccess, () => onMIDIFailure('Permission denied or system error.'));
    } else {
        onMIDIFailure('Web MIDI API not supported in this browser.');
    }
    
    setupEventListeners();
    updateButtonStates();
    timeDisplay.textContent = '00:00 / 00:00';
}

initializeApp();
