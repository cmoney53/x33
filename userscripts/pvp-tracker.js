// ==UserScript==
// @name          Dredark PvP MOTD Tracker
// @namespace     http://tampermonkey.net/
// @version       17.0 // Version updated for public command usage
// @description   Auto PvP MOTD with real-time countdown and timezone switching. Chess logic removed.
// @author        Gemini
// @match         *://*.drednot.io/*
// @grant         GM_xmlhttpRequest
// @connect       drednot.io
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================================
    // IMPORTANT: DOM SELECTOR CONFIGURATION
    // These selectors MUST match the IDs or classes on your specific Dredark game page.
    // If the script does not work, check these first!
    // =========================================================================================
    const chatBoxSelector = "#chat"; 
    const chatInpSelector = "#chat-input";
    const chatBtnSelector = "#chat-send";
    const chatContentSelector = "#chat-content";
    const motdEditSelector = "#motd-edit-button";
    const motdTextSelector = "#motd-edit-text";
    const motdSaveSelector = "#motd-edit .btn-green";
    const motdSavedTextSelector = "#motd-text"; // The element displaying the current MOTD

    // --- Element Variables ---
    let chatBox, chatInp, chatBtn, chatContent, motdEdit, motdText, motdSave, motdSavedText;
    
    // Global variables for PvP MOTD state
    let baseEvents = []; // Stores the parsed PvP event data (Date objects)
    let pvpUpdaterActive = false; // Flag to indicate if the auto-updater is running
    let pvpInterval = null; // Holds the ID for the setInterval timer
    let originalMOTD = ""; // Stores the MOTD content before the script modifies it
    let currentTimezone = undefined; // Stores the current IANA timezone string (e.g., "America/New_York") or undefined for local
    let minCountdownMs = Infinity; // Track the minimum countdown for the next event

    // =========================================================================================
    // TIMEZONE MAP (Retained for !tz command functionality)
    // =========================================================================================
    const TIMEZONE_MAP = {
        "local": undefined,           // Undefined means use browser's local timezone
        "utc": "UTC",                 // Coordinated Universal Time
        "us": "America/New_York",     // US Eastern Time (representative for 'us')
        "et": "America/New_York",
        "ct": "America/Chicago",
        "mt": "America/Denver",
        "pt": "America/Los_Angeles",
        "uk": "Europe/London",
        "eu": "Europe/Berlin",
        "jp": "Asia/Tokyo",
        "au": "Australia/Sydney",
        "nz": "Pacific/Auckland",
        "cn": "Asia/Shanghai",
        "in": "Asia/Kolkata"
        // Many other timezones removed for brevity but can be added back if needed
    };

    const BASIC_TIMEZONES = [
        "local", "utc", "et", "ct", "mt", "pt", "uk", "eu", "jp", "au", "nz", "cn", "in"
    ];

    // =========================================================================================
    // HELPER FUNCTIONS
    // =========================================================================================

    /**
     * Initializes all necessary DOM elements.
     * @returns {boolean} True if all required elements are found, false otherwise.
     */
    function initializeElements() {
        chatBox = document.querySelector(chatBoxSelector);
        chatInp = document.querySelector(chatInpSelector);
        chatBtn = document.querySelector(chatBtnSelector);
        chatContent = document.querySelector(chatContentSelector);
        motdEdit = document.querySelector(motdEditSelector);
        motdText = document.querySelector(motdTextSelector);
        motdSave = document.querySelector(motdSaveSelector);
        motdSavedText = document.querySelector(motdSavedTextSelector);

        const requiredElements = {
            "MOTD Display": motdSavedText,
            "MOTD Edit Button": motdEdit,
            "MOTD Input Field": motdText,
            "MOTD Save Button": motdSave,
            "Chat Content Area": chatContent,
            "Chat Input Field": chatInp,
            "Chat Send Button": chatBtn,
            "Chat Box": chatBox
        };

        let allFound = true;
        for (const [name, element] of Object.entries(requiredElements)) {
            if (!element) {
                console.error(`[PvP MOTD ERROR] Required element not found: ${name} (Selector: ${Object.keys(requiredElements).find(key => requiredElements[key] === element)})`);
                allFound = false;
            }
        }
        
        if (!allFound) {
            console.error("[PvP MOTD ERROR] Script initialization failed due to missing DOM elements. Please check your CSS selectors!");
        } else {
             console.log("[PvP MOTD] All required DOM elements found. Script ready.");
        }
        
        return allFound;
    }


    /**
     * Gets the current date and time formatted according to the current timezone setting.
     * @returns {string} The formatted date string.
     */
    function getCurrentFormattedDate() {
        const now = new Date();
        const options = {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
            timeZone: currentTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone // Use local if undefined
        };
        
        // Custom formatting logic for timezone display
        let timeZoneLabel = currentTimezone === "UTC" ? "UTC" : "Local";
        if (currentTimezone && currentTimezone !== "UTC") {
            timeZoneLabel = currentTimezone.split('/').pop().replace(/_/g, ' ');
        }

        const dateString = new Intl.DateTimeFormat('en-US', options).format(now);
        return `${dateString} (${timeZoneLabel})`;
    }

    /**
     * Helper function to pad a number with a leading zero (e.g., 5 -> "05")
     */
    const pad = (n) => n.toString().padStart(2, "0");

    /**
     * Calculates the next upcoming occurrence of a weekly event based on a given date.
     * @param {Date} date The base Date object for the event.
     * @returns {Date} The Date object for the next upcoming occurrence.
     */
    function getNextOccurrence(date) {
        const now = new Date();
        let next = new Date(date);
        while (next <= now) {
            next.setDate(next.getDate() + 7);
        }
        return next;
    }

    /**
     * Formats a given time difference in milliseconds into a "HH:MM:SS" countdown string.
     * Returns "LIVE" if the milliseconds are zero or negative.
     * @param {number} ms The time difference in milliseconds.
     * @returns {string} The formatted countdown string or "LIVE".
     */
    function formatCountdown(ms) {
        if (ms <= 0) return "LIVE";
        const sec = Math.floor(ms / 1000);
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }
    
    /**
     * Gets the current IANA timezone name based on the script's state.
     * @returns {string} The display name of the current timezone.
     */
    function getTimezoneDisplayName() {
        if (currentTimezone === "UTC") return "UTC";
        if (!currentTimezone) return "Local";
        try {
            // Attempt to get a readable name from the IANA string
            return currentTimezone.split('/').pop().replace(/_/g, ' ');
        } catch (e) {
            return currentTimezone;
        }
    }


    // =========================================================================================
    // MOTD LOGIC
    // =========================================================================================

    /**
     * Constructs the main MOTD content with the PvP countdown.
     * @returns {string} The formatted MOTD string.
     */
    function buildMOTD() {
        const dateString = getCurrentFormattedDate();
        let motd = `[${dateString}]\n`;
        
        if (baseEvents.length === 0) {
            motd += "⚠️ PvP Schedule Loading/Not Found! Type !pvp to check status.\n";
            return motd;
        }

        let nextEvent = null;
        minCountdownMs = Infinity; // Reset for recalculation

        // Find the next upcoming event
        baseEvents.forEach(event => {
            const nextOccurrence = getNextOccurrence(event.time);
            const countdownMs = nextOccurrence.getTime() - new Date().getTime();

            if (countdownMs < minCountdownMs) {
                minCountdownMs = countdownMs;
                nextEvent = nextOccurrence;
            }
        });

        const countdown = formatCountdown(minCountdownMs);
        const tzDisplay = getTimezoneDisplayName();
        
        let countdownLine = "";
        if (countdown === "LIVE") {
             countdownLine = `🔥 **PVP IS LIVE NOW!** (Next starts in 7 days)`;
        } else {
             // Use UTC for the next time display if using local/no TZ specified 
             // to show the raw scheduled time, otherwise use the set timezone.
             const timeZoneForNextTime = currentTimezone || 'UTC'; 

             const nextTime = nextEvent.toLocaleString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit', 
                timeZone: timeZoneForNextTime
             });
             countdownLine = `Next PvP starts in: **${countdown}**`;
             countdownLine += `\nTime (${tzDisplay}): ${nextTime}`;
        }
        
        motd += countdownLine;
        motd += "\n\n---";
        motd += "\nCommands: !pvp (toggle), !tz <timezone/code>";
        
        return motd;
    }

    /**
     * Updates the MOTD display element and saves it (if possible).
     * @param {string|null} content The content to set, or null to use the auto-generated content.
     */
    function updateDisplayMOTD(content = null) {
        if (!motdSavedText || !motdEdit || !motdText || !motdSave) return;

        const newMOTD = content || buildMOTD();
        
        // 1. Update the MOTD text field (requires clicking edit first)
        motdEdit.click();
        motdText.value = newMOTD;
        
        // 2. Save the MOTD
        motdSave.click();
        
        // 3. Update the displayed MOTD text (for immediate visual feedback)
        motdSavedText.innerText = newMOTD; 

        // Close the edit box if open
        const closeBtn = document.querySelector("#motd-edit .btn-red");
        if (closeBtn) closeBtn.click();
        
        console.log(`[PvP MOTD] MOTD updated. Countdown: ${formatCountdown(minCountdownMs)}`);
    }

    // =========================================================================================
    // INTERVAL & CONTROL LOGIC
    // =========================================================================================

    /**
     * Starts the recurring MOTD update interval.
     */
    function startPVPUpdater() {
        if (pvpInterval) clearInterval(pvpInterval);
        
        // Start the continuous update interval
        pvpInterval = setInterval(() => {
            updateDisplayMOTD();
        }, 1000);
        
        // Run immediately once
        updateDisplayMOTD();
    }
    
    /**
     * Stops the recurring MOTD update interval and restores the original MOTD.
     */
    function stopPVPUpdaterAndRestore() {
        if (pvpInterval) clearInterval(pvpInterval);
        pvpInterval = null;

        // Restore previous MOTD
        if (originalMOTD && motdSavedText) {
             updateDisplayMOTD(originalMOTD);
        } else {
             // Fallback if originalMOTD was never saved
             updateDisplayMOTD("PvP MOTD auto-update DISABLED. Restore failed.");
        }
    }

    // =========================================================================================
    // CHAT & COMMAND LOGIC
    // =========================================================================================

    /**
     * Sends a message to the in-game chat.
     * @param {string} message The message to send.
     */
    function sendChat(message) {
        if (!chatBox || !chatInp || !chatBtn) {
            console.error("[PvP MOTD ERROR] Cannot send chat: Chat elements not found.");
            return;
        }

        // Use a short delay to ensure the chat window is responsive
        setTimeout(() => {
            // Check if the chat input is ready and send the message
            if (chatInp.value === '') { 
                chatInp.value = message;
                chatBtn.click();
                chatInp.value = ''; // Clear input after sending
            } else {
                // If the input is occupied, log an error or queue the message
                console.warn("[PvP MOTD] Chat input busy, message was not sent automatically.");
            }
        }, 50);
    }

    /**
     * Handles incoming chat messages to process commands.
     * @param {string} messageText The text content of the message.
     * @param {string} username The username who sent the message.
     */
    function handleChatCommand(messageText, username) {
        const command = messageText.toLowerCase().trim();
        const parts = command.split(/\s+/);
        const cmd = parts[0];
        const arg = parts[1];
        
        // --- Command Check: !pvp (Toggle) ---
        // This command is now available to EVERYONE.
        if (cmd === "!pvp") {
            pvpUpdaterActive = !pvpUpdaterActive;

            if (pvpUpdaterActive) {
                // Save current MOTD content BEFORE starting the update
                originalMOTD = motdSavedText?.innerText || ""; 
                startPVPUpdater();
                sendChat("✅ PvP MOTD auto-update ENABLED by " + username);
            } else {
                stopPVPUpdaterAndRestore();
                sendChat("❌ PvP MOTD auto-update DISABLED by " + username + " — previous MOTD restored.");
            }
            return;
        }
        
        // --- Command Check: !tz (Timezone Switcher) ---
        // This command is now available to EVERYONE.
        if (cmd === "!tz") {
            if (!arg) {
                sendChat(`Current TZ: ${getTimezoneDisplayName()}. Use !tz <local|utc|code> (e.g., !tz pt). Available: ${BASIC_TIMEZONES.join(', ')}`);
                return;
            }
            
            const newTz = TIMEZONE_MAP[arg];
            if (newTz !== undefined || arg === "local" || arg === "utc") {
                currentTimezone = newTz;
                // If the updater is active, force an immediate update
                if (pvpUpdaterActive) {
                    updateDisplayMOTD();
                }
                sendChat(`🌐 Timezone set to: **${getTimezoneDisplayName()}** by ${username}.`);
            } else {
                sendChat(`❌ Invalid timezone code '${arg}'. Try: ${BASIC_TIMEZONES.join(', ')}`);
            }
            return;
        }

        // No other commands are processed
    }

    /**
     * Sets up the MutationObserver to listen for new chat messages.
     */
    function observeChat() {
        if (!chatContent) {
            console.error("[PvP MOTD ERROR] Cannot observe chat: chatContent element not found.");
            return;
        }
        
        new MutationObserver((mutations) => {
            // Only process the last message added (the newest one)
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // Start from the last added node
                    const msg = mutation.addedNodes[mutation.addedNodes.length - 1]; 
                    if (!msg || msg.nodeType !== 1) continue; 
                    
                    const usernameEl = msg.querySelector("bdi");
                    if (!usernameEl) continue; // Skip system messages (no BDI element)
                    
                    const username = usernameEl.textContent;
                    
                    // Find the text node after the username tag
                    let messageText = '';
                    let foundUsername = false;
                    for (const node of msg.childNodes) {
                        if (node.nodeType === 1 && node.tagName === 'B') {
                            foundUsername = true; // Found the username bold tag
                            continue;
                        }
                        if (foundUsername && node.nodeType === 3) {
                             messageText = node.textContent.trim();
                             break; // We found the message text immediately after the username
                        }
                    }

                    if (messageText && messageText.startsWith('!')) {
                        handleChatCommand(messageText, username);
                    }
                }
            }
        }).observe(chatContent, { childList: true });
        
        console.log("[PvP MOTD] Chat observer initialized.");
    }
    
    // =========================================================================================
    // DATA FETCHING LOGIC
    // =========================================================================================
    
    /**
     * Fetches live PvP event data from the Drednot.io PvP events page.
     */
    function fetchLiveEvents() {
        console.log("[PvP MOTD] Starting fetch for PvP events...");
        
        const months = {
            Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
            Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
        };
        const eventRegex = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*,\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s*\|\s*(\d{1,2}:\d{2}\s*(?:AM|PM))/g;

        GM_xmlhttpRequest({
            method: "GET",
            url: "https://drednot.io/pvp-events/",
            onload: function (response) {
                if (response.status !== 200) {
                    console.error(`[PvP MOTD ERROR] Failed to fetch PvP events. Status: ${response.status}`);
                    return;
                }
                
                try {
                    const rawText = response.responseText;
                    const events = [];
                    const now = new Date();
                    const currentYear = now.getFullYear();
                    let match;

                    while ((match = eventRegex.exec(rawText)) !== null) {
                        const monthStr = match[1];
                        const dayNum = parseInt(match[2]);
                        const timeStr = match[3];

                        const timeParts = timeStr.split(" ");
                        if (timeParts.length < 2) continue;

                        const [hourRaw, minuteRaw] = timeParts[0].split(":");
                        let hour = parseInt(hourRaw);
                        let minute = parseInt(minuteRaw);
                        const ampm = timeParts[1];

                        if (isNaN(hour) || isNaN(minute) || (ampm !== "AM" && ampm !== "PM")) continue;

                        if (ampm === "PM" && hour !== 12) hour += 12;
                        if (ampm === "AM" && hour === 12) hour = 0;

                        let eventDate = new Date(currentYear, months[monthStr], dayNum, hour, minute);
                        
                        if (isNaN(eventDate.getTime())) continue;

                        if (eventDate < new Date(now.getTime() - (24 * 60 * 60 * 1000))) {
                             eventDate.setFullYear(currentYear + 1);
                        }

                        events.push({ time: eventDate });
                    }
                    
                    if (events.length > 0) {
                        baseEvents = events;
                        console.log(`[PvP MOTD] Successfully parsed ${baseEvents.length} PvP events.`);
                    } else {
                         console.warn("[PvP MOTD] No events parsed. The PvP schedule format may have changed.");
                    }

                } catch (e) {
                    console.error("[PvP MOTD ERROR] Error during event parsing:", e);
                }
            },
            onerror: function (error) {
                console.error("[PvP MOTD ERROR] Network error fetching PvP events:", error);
            }
        });
    }

    // =========================================================================================
    // MAIN EXECUTION
    // =========================================================================================

    window.addEventListener('load', () => {
        // 1. Initialize DOM elements
        if (!initializeElements()) {
            return;
        }

        // 2. Fetch the PvP schedule immediately
        fetchLiveEvents();

        // 3. Set up the chat command listener
        observeChat();
        
        console.log(`[PvP MOTD] Script loaded. Commands !pvp and !tz are now usable by everyone.`);
    });

})();
