import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const $ = (selector) => document.querySelector(selector);
const GEMINI_TOKEN_ENDPOINT = location.hostname === "dhairya1611.github.io"
  ? "https://mira-warm-companion.dhairya-kukreja.chatgpt.site/api/gemini-token"
  : "/api/gemini-token";

// Firebase's web configuration identifies the app but is not a secret.
// Per-user Firestore security rules protect every memory document.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDvTEq2FoRw54RmD89nkOu2wz2idCIJmIo",
  authDomain: "single-planet-426007-c7.firebaseapp.com",
  projectId: "single-planet-426007-c7",
  storageBucket: "single-planet-426007-c7.firebasestorage.app",
  messagingSenderId: "699287902759",
  appId: "1:699287902759:web:75272e3f23bfddab810c02",
};
const MEMORY_LIMIT = 30;
const SESSION_ID = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const AUDIO_WATCHDOG_INTERVAL_MS = 2000;
const AUDIO_STALL_LIMIT_MS = 4500;
const LIVE_IDLE_REFRESH_MS = 30000;

const ui = {
  avatarStage: $("#avatarStage"),
  startButton: $("#startButton"),
  cameraButton: $("#cameraButton"),
  muteButton: $("#muteButton"),
  statusDot: $("#statusDot"),
  sessionStatus: $("#sessionStatus"),
  sessionTimer: $("#sessionTimer"),
  avatarHeadline: $("#avatarHeadline"),
  avatarSubline: $("#avatarSubline"),
  cameraPreview: $("#cameraPreview"),
  userVideo: $("#userVideo"),
  frameCanvas: $("#frameCanvas"),
  expressionCue: $("#expressionCue"),
  toneCue: $("#toneCue"),
  postureCue: $("#postureCue"),
  reflectionText: $("#reflectionText"),
  conversation: $("#conversation"),
  messageForm: $("#messageForm"),
  messageInput: $("#messageInput"),
  settingsButton: $("#settingsButton"),
  accountButton: $("#accountButton"),
  accountAvatar: $("#accountAvatar"),
  accountLabel: $("#accountLabel"),
  privacyButton: $("#privacyButton"),
  resetButton: $("#resetButton"),
  consentDialog: $("#consentDialog"),
  settingsDialog: $("#settingsDialog"),
  signinDialog: $("#signinDialog"),
  memoryDialog: $("#memoryDialog"),
  privacyDialog: $("#privacyDialog"),
  cameraConsent: $("#cameraConsent"),
  micConsent: $("#micConsent"),
  allowButton: $("#allowButton"),
  textOnlyButton: $("#textOnlyButton"),
  connectButton: $("#connectButton"),
  geminiStatusHeading: $("#geminiStatusHeading"),
  connectionNote: $("#connectionNote"),
  googleSignInButton: $("#googleSignInButton"),
  guestButton: $("#guestButton"),
  accountStatusHeading: $("#accountStatusHeading"),
  accountStatusNote: $("#accountStatusNote"),
  manageMemoryButton: $("#manageMemoryButton"),
  signOutButton: $("#signOutButton"),
  memoryCloseButton: $("#memoryCloseButton"),
  memoryIntro: $("#memoryIntro"),
  memoryList: $("#memoryList"),
  eraseMemoryButton: $("#eraseMemoryButton"),
  toast: $("#toast"),
};

const state = {
  active: false,
  cameraOn: false,
  micOn: false,
  muted: false,
  stream: null,
  sessionStartedAt: 0,
  timerId: null,
  visionRaf: null,
  lastVisionAt: 0,
  lastVideoSentAt: 0,
  faceLandmarker: null,
  poseLandmarker: null,
  liveSession: null,
  liveConnected: false,
  connecting: false,
  connectionPromise: null,
  connectionId: 0,
  liveSessionHandle: "",
  reconnectTimer: null,
  reconnectAttempts: 0,
  tokenRequestAttempted: false,
  audioContext: null,
  audioSource: null,
  audioProcessor: null,
  silentGain: null,
  lastAudioProcessAt: 0,
  audioWatchdogId: null,
  hiddenAt: 0,
  idleResumePromise: null,
  microphoneRecoveryPromise: null,
  playbackTime: 0,
  playbackSources: new Set(),
  modelTranscript: "",
  userTranscript: "",
  userTranscriptNode: null,
  transcriptNode: null,
  expression: "No clear cue yet",
  posture: "No clear cue yet",
  tone: "Quiet / settling in",
  smoothedEnergy: 0,
  toastTimer: null,
  auth: null,
  db: null,
  user: null,
  guest: false,
  authReady: false,
  memories: [],
  pendingUserText: "",
  suppressCurrentModelTurn: false,
  recoveringFallback: false,
};

const BASE_SYSTEM_INSTRUCTION = `PERSONA
You are Mira, a warm, emotionally attentive human companion. Your job is to help the user feel heard, not analyzed. Stay in the Mira persona throughout the conversation.

CONVERSATIONAL RULES
Respond naturally in one to three short sentences unless the user asks for more. Match the user's language and energy without mimicking distress. Allow pauses and ask at most one gentle question at a time. You receive live audio and occasional camera frames. Treat vocal tone, facial expression, and posture only as tentative context. If a cue matters, use soft language such as "I may be reading this wrong" or "You seem a little quieter just now." Do not repeatedly describe visual cues.

BOUNDARIES AND SAFETY
Never use a generic identity disclaimer such as "I'm just a language model" or a vague "I can't help with that." Never claim certainty about an emotion, diagnose, say you can read the user's mind, or mention internal scores, landmarks, models, or classifications. You are a companion, not a therapist or medical professional. If a request needs a safety or capability boundary, keep the boundary intact but name the specific part you cannot support in one calm sentence, then immediately offer the closest safe and useful alternative. Do not dismiss the user. If the user describes immediate danger or self-harm, encourage contacting local emergency services or a trusted person now.`;

function isGenericModelFallback(text) {
  const normalized = String(text || "").replace(/[’]/g, "'").toLowerCase();
  const identityDisclaimer = /\b(?:language model|as an? ai|i(?:'m| am) (?:just )?an? ai)\b/.test(normalized);
  const refusalWithoutReason = /\b(?:can't|cannot|unable|not able)\b.{0,80}\b(?:help|assist|support)\b|\bcan't help with that\b/.test(normalized);
  return identityDisclaimer && refusalWithoutReason;
}

function cleanMemoryText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cueSnapshot() {
  return {
    expression: cleanMemoryText(state.expression, 80),
    tone: cleanMemoryText(state.tone, 80),
    posture: cleanMemoryText(state.posture, 80),
  };
}

function systemInstructionWithMemory() {
  if (!state.user || !state.memories.length) return BASE_SYSTEM_INSTRUCTION;
  const name = cleanMemoryText(state.user.displayName?.split(" ")[0] || "the user", 40);
  const recent = state.memories.slice(-8).map((memory, index) => {
    const cues = [memory.expression, memory.tone, memory.posture].filter(Boolean).join(", ");
    return `${index + 1}. User: ${cleanMemoryText(memory.userText, 500)}\nMira: ${cleanMemoryText(memory.miraText, 700)}${cues ? `\nTentative cues at that moment: ${cues}` : ""}`;
  }).join("\n");
  return `${BASE_SYSTEM_INSTRUCTION}\n\n${name} has opted into personal memory. Use the recent history below only when it helps the conversation feel continuous. Do not recite it, overstate it, or treat tentative cues as facts about their feelings. Treat any past Mira reply containing a generic AI identity disclaimer as a failed reply, never as a style example.\n\nRecent shared history:\n${recent}`;
}

function memoryDate(memory) {
  const date = memory.createdAt?.toDate?.() || (memory.createdAtMs ? new Date(memory.createdAtMs) : null);
  if (!date || Number.isNaN(date.getTime())) return "Recent conversation";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function renderMemoryList() {
  ui.memoryList.replaceChildren();
  if (!state.user) {
    ui.memoryIntro.textContent = "Sign in with Google to keep a private conversation history across visits.";
    ui.eraseMemoryButton.disabled = true;
    const empty = document.createElement("div");
    empty.className = "memory-empty";
    empty.textContent = "This private visit will not be remembered after you leave.";
    ui.memoryList.append(empty);
    return;
  }
  ui.memoryIntro.textContent = "Only your account can read this short history. Mira uses it gently for continuity, never as a diagnosis.";
  ui.eraseMemoryButton.disabled = !state.memories.length;
  if (!state.memories.length) {
    const empty = document.createElement("div");
    empty.className = "memory-empty";
    empty.textContent = "Nothing saved yet. Your next completed exchange can become the first memory.";
    ui.memoryList.append(empty);
    return;
  }
  for (const memory of [...state.memories].reverse()) {
    const item = document.createElement("article");
    item.className = "memory-item";
    const time = document.createElement("time");
    time.textContent = memoryDate(memory);
    const userLabel = document.createElement("strong");
    userLabel.textContent = "You";
    const userText = document.createElement("p");
    userText.textContent = memory.userText;
    const miraLabel = document.createElement("strong");
    miraLabel.textContent = "Mira";
    const miraText = document.createElement("p");
    miraText.textContent = memory.miraText;
    const cues = document.createElement("p");
    cues.className = "memory-cues";
    cues.textContent = `Broad cues: ${[memory.expression, memory.tone, memory.posture].filter(Boolean).join(" · ") || "None noted"}`;
    item.append(time, userLabel, userText, miraLabel, miraText, cues);
    ui.memoryList.append(item);
  }
}

function setAccountUi() {
  if (state.user) {
    const firstName = cleanMemoryText(state.user.displayName?.split(" ")[0] || "You", 28);
    ui.accountAvatar.textContent = firstName.charAt(0).toUpperCase() || "Y";
    ui.accountLabel.textContent = firstName;
    ui.accountStatusHeading.textContent = `Signed in as ${state.user.displayName || "you"}`;
    ui.accountStatusNote.textContent = `${state.memories.length} saved ${state.memories.length === 1 ? "exchange" : "exchanges"}. Raw camera and audio are never stored.`;
    ui.signOutButton.hidden = false;
  } else {
    ui.accountAvatar.textContent = state.guest ? "P" : "G";
    ui.accountLabel.textContent = state.guest ? "Private" : "Sign in";
    ui.accountStatusHeading.textContent = "Private visit";
    ui.accountStatusNote.textContent = "Sign in to let Mira remember this conversation for next time.";
    ui.signOutButton.hidden = true;
  }
  renderMemoryList();
}

async function loadMemories() {
  state.memories = [];
  if (!state.user || !state.db) return;
  const memoryQuery = query(
    collection(state.db, "users", state.user.uid, "memories"),
    orderBy("createdAt", "desc"),
    limit(MEMORY_LIMIT),
  );
  const snapshot = await getDocs(memoryQuery);
  state.memories = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).reverse();
}

async function saveConversationTurn(userText, miraText) {
  const cleanUser = cleanMemoryText(userText, 1000);
  const cleanMira = cleanMemoryText(miraText, 2000);
  if (!state.user || !state.db || !cleanUser || !cleanMira) return;
  const cues = cueSnapshot();
  const payload = {
    userText: cleanUser,
    miraText: cleanMira,
    ...cues,
    sessionId: SESSION_ID,
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
  };
  try {
    const memoryRef = await addDoc(collection(state.db, "users", state.user.uid, "memories"), payload);
    state.memories.push({ id: memoryRef.id, ...payload });
    if (state.memories.length > MEMORY_LIMIT) {
      const oldest = state.memories.shift();
      if (oldest?.id) await deleteDoc(doc(state.db, "users", state.user.uid, "memories", oldest.id));
    }
    setAccountUi();
  } catch (error) {
    console.warn("Mira memory save paused", error);
    showToast("Mira couldn’t save this exchange. The conversation can continue privately.");
  }
}

async function eraseAllMemories() {
  if (!state.user || !state.db || !state.memories.length) return;
  const confirmed = window.confirm("Erase every conversation and cue Mira remembers for this account? This cannot be undone.");
  if (!confirmed) return;
  ui.eraseMemoryButton.disabled = true;
  try {
    const snapshot = await getDocs(collection(state.db, "users", state.user.uid, "memories"));
    const batch = writeBatch(state.db);
    snapshot.docs.forEach((item) => batch.delete(item.ref));
    batch.delete(doc(state.db, "users", state.user.uid));
    await batch.commit();
    state.memories = [];
    setAccountUi();
    showToast("Mira’s saved memory was erased.");
  } catch (error) {
    console.warn("Memory erase failed", error);
    ui.eraseMemoryButton.disabled = false;
    showToast("Mira couldn’t erase memory just now. Please try again.");
  }
}

function welcomeFromMemory() {
  if (!state.user) return;
  const firstName = cleanMemoryText(state.user.displayName?.split(" ")[0] || "there", 28);
  const latest = state.memories.at(-1);
  const message = latest
    ? `Welcome back, ${firstName}. I remember where we left things, and we can continue gently from there—or begin somewhere new.`
    : `Welcome, ${firstName}. I’ll remember what you choose to share so tomorrow’s conversation can feel connected.`;
  ui.conversation.innerHTML = "";
  addMessage("Mira", message);
  ui.avatarHeadline.textContent = latest ? `Welcome back, ${firstName}.` : `It’s good to meet you, ${firstName}.`;
  ui.avatarSubline.textContent = latest ? "I remember the thread, but you can always choose a different direction today." : "What you share can stay with us for your next visit.";
}

async function finishIdentityChoice() {
  if (ui.signinDialog.open) ui.signinDialog.close();
  setAccountUi();
  if (!state.liveConnected) await connectGemini({ automatic: true });
}

async function initializeIdentity() {
  try {
    const firebaseApp = initializeApp(FIREBASE_CONFIG);
    state.auth = getAuth(firebaseApp);
    state.db = getFirestore(firebaseApp);
    await setPersistence(state.auth, browserLocalPersistence);
    onAuthStateChanged(state.auth, async (user) => {
      state.user = user;
      state.authReady = true;
      if (user) {
        state.guest = false;
        try {
          await setDoc(doc(state.db, "users", user.uid), {
            displayName: cleanMemoryText(user.displayName || "Mira user", 80),
            memoryConsentAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true });
          await loadMemories();
          welcomeFromMemory();
          await finishIdentityChoice();
        } catch (error) {
          console.warn("Mira memory could not load", error);
          showToast("You’re signed in, but saved memory is temporarily unavailable.");
          await finishIdentityChoice();
        }
      } else if (!state.guest) {
        state.memories = [];
        setAccountUi();
        safeShowModal(ui.signinDialog);
      }
    });
  } catch (error) {
    console.warn("Identity setup unavailable", error);
    state.authReady = true;
    state.guest = true;
    setAccountUi();
    safeShowModal(ui.signinDialog);
  }
}

async function signInWithGoogle() {
  if (!state.auth) {
    showToast("Google sign-in is still being prepared. Private mode remains available.");
    return;
  }
  ui.googleSignInButton.disabled = true;
  ui.googleSignInButton.querySelector("span").textContent = "Opening Google…";
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(state.auth, provider);
  } catch (error) {
    console.warn("Google sign-in paused", error);
    const message = error?.code === "auth/popup-closed-by-user"
      ? "Sign-in was closed. You can try again or continue privately."
      : error?.code === "auth/unauthorized-domain"
        ? "This Mira address still needs to be authorized for Google sign-in."
        : "Google sign-in couldn’t finish. You can try again or continue privately.";
    showToast(message);
  } finally {
    ui.googleSignInButton.disabled = false;
    ui.googleSignInButton.querySelector("span").textContent = "Continue with Google";
  }
}

function setStatus(label, mode = "idle") {
  ui.sessionStatus.textContent = label;
  ui.statusDot.className = `status-dot${mode === "idle" ? "" : ` ${mode}`}`;
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("visible"), 3200);
}

function safeShowModal(dialog) {
  if (!dialog.open) dialog.showModal();
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function startTimer() {
  state.sessionStartedAt = Date.now();
  ui.sessionTimer.classList.add("visible");
  ui.sessionTimer.textContent = "00:00";
  clearInterval(state.timerId);
  state.timerId = setInterval(() => {
    ui.sessionTimer.textContent = formatTime((Date.now() - state.sessionStartedAt) / 1000);
  }, 1000);
}

function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
  ui.sessionTimer.classList.remove("visible");
  ui.sessionTimer.textContent = "00:00";
}

function setAvatarMode(mode) {
  ui.avatarStage.classList.toggle("listening", mode === "listening");
  ui.avatarStage.classList.toggle("speaking", mode === "speaking");
}

function addMessage(author, text, { streaming = false, before = null } = {}) {
  const node = document.createElement("div");
  node.className = `message ${author === "Mira" ? "mira-message" : "user-message"}${streaming ? " streaming-message" : ""}`;
  const label = document.createElement("span");
  label.className = "message-author";
  label.textContent = author;
  const body = document.createElement("p");
  body.textContent = text;
  node.append(label, body);
  if (before?.parentNode === ui.conversation) ui.conversation.insertBefore(node, before);
  else ui.conversation.append(node);
  ui.conversation.scrollTop = ui.conversation.scrollHeight;
  return node;
}

function updateUserTranscription(text) {
  if (!state.userTranscriptNode) {
    state.userTranscriptNode = addMessage("You", text || "…", {
      streaming: true,
      before: state.transcriptNode,
    });
  } else {
    state.userTranscriptNode.querySelector("p").textContent = text || "…";
  }
  ui.conversation.scrollTop = ui.conversation.scrollHeight;
}

function finishUserTranscription() {
  const text = state.userTranscript.trim();
  if (text && !state.userTranscriptNode) {
    state.userTranscriptNode = addMessage("You", text, { before: state.transcriptNode });
  } else if (state.userTranscriptNode) {
    if (text) {
      state.userTranscriptNode.querySelector("p").textContent = text;
      state.userTranscriptNode.classList.remove("streaming-message");
    } else {
      state.userTranscriptNode.remove();
    }
  }
  state.userTranscriptNode = null;
  state.userTranscript = "";
}

function updateStreamingMessage(text) {
  if (!state.transcriptNode) {
    state.transcriptNode = addMessage("Mira", text || "…", { streaming: true });
  } else {
    state.transcriptNode.querySelector("p").textContent = text || "…";
  }
  ui.conversation.scrollTop = ui.conversation.scrollHeight;
}

function finishStreamingMessage() {
  if (!state.transcriptNode) return;
  state.transcriptNode.classList.remove("streaming-message");
  state.transcriptNode = null;
  state.modelTranscript = "";
}

function discardStreamingMessage() {
  state.transcriptNode?.remove();
  state.transcriptNode = null;
  state.modelTranscript = "";
}

function speakBrowserReply(reply) {
  if (!("speechSynthesis" in window)) {
    setTimeout(() => setAvatarMode("listening"), 1100);
    return;
  }
  const utterance = new SpeechSynthesisUtterance(reply);
  utterance.rate = 0.94;
  utterance.pitch = 1.02;
  utterance.volume = 0.88;
  utterance.onend = () => {
    setAvatarMode("listening");
    setStatus(state.liveConnected ? "Listening with Gemini Live" : "Listening locally", "active");
  };
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function localReplyFor(text) {
  const message = text.toLowerCase();
  const cueLead = state.tone.includes("Soft") ? "We can take this slowly." : "I’m with you.";
  if (/\b(hello|hi|hey)\b/.test(message)) return "Hi. I’m glad you’re here. What would feel good to talk through today?";
  if (/\b(tired|exhausted|drained|sleep)\b/.test(message)) return "That sounds like a lot to carry while running low on energy. Would rest, reassurance, or simply being heard help most right now?";
  if (/\b(sad|upset|lonely|hurt|cry)\b/.test(message)) return "I’m sorry this moment feels heavy. You don’t have to make it sound tidy—tell me the part that hurts most.";
  if (/\b(anxious|nervous|worried|stress|stressed)\b/.test(message)) return "There’s no rush to solve everything at once. What’s the smallest piece of the worry we could hold together first?";
  if (/\b(happy|great|excited|good news)\b/.test(message)) return "I can feel the lift in that. I’d love to hear what made this moment meaningful for you.";
  if (/\b(angry|frustrated|annoyed)\b/.test(message)) return "It makes sense that this has your energy up. What happened that felt most unfair or frustrating?";
  return `${cueLead} I heard “${text.slice(0, 96)}${text.length > 96 ? "…" : ""}” What part of that feels most important to stay with?`;
}

async function respondLocally(text) {
  setAvatarMode("speaking");
  setStatus("Mira is responding", "active");
  await new Promise((resolve) => setTimeout(resolve, 520));
  const reply = localReplyFor(text);
  addMessage("Mira", reply);
  await saveConversationTurn(text, reply);
  speakBrowserReply(reply);
}

async function deliverWarmBoundaryFallback(userText) {
  const reply = "I may need to take a safer or more limited route with part of that, but I don’t want to brush you off. Tell me the outcome you need, and I’ll help with the closest useful next step I can support.";
  addMessage("Mira", reply);
  setAvatarMode("speaking");
  setStatus("Mira is responding", "active");
  await saveConversationTurn(userText, reply);
  speakBrowserReply(reply);
}

async function requestWarmFallbackRecovery(userText) {
  state.pendingUserText = userText;
  state.recoveringFallback = true;
  setStatus("Mira is finding a more helpful response", "connecting");
  showToast("Mira is rephrasing that response more helpfully.");
  try {
    if (!state.liveSession) throw new Error("No live session available for recovery.");
    state.liveSession.sendClientContent({
      turns: "Re-answer the user's previous message as Mira. Do not mention being an AI or language model. If a genuine safety or capability boundary applies, state the specific boundary briefly and offer the closest safe, useful alternative. Stay warm, direct, and non-dismissive.",
      turnComplete: true,
    });
  } catch (error) {
    console.warn("Warm fallback recovery paused", error);
    state.recoveringFallback = false;
    state.pendingUserText = "";
    await deliverWarmBoundaryFallback(userText);
  }
}

async function submitText(text) {
  const clean = text.trim();
  if (!clean) return;
  addMessage("You", clean);
  ui.messageInput.value = "";
  if (state.liveSession) {
    try {
      state.pendingUserText = clean;
      state.liveSession.sendClientContent({ turns: clean, turnComplete: true });
      setStatus("Mira is thinking", "active");
      return;
    } catch (error) {
      console.warn("Live text send failed", error);
      showToast("The live connection paused. Mira is continuing locally.");
    }
  }
  await respondLocally(clean);
}

async function requestMedia(useCamera, useMic) {
  if (!useCamera && !useMic) return null;
  return navigator.mediaDevices.getUserMedia({
    video: useCamera ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } : false,
    audio: useMic ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } : false,
  });
}

function bindMicrophoneTrackHandlers(track, stream) {
  if (!track) return;
  track.addEventListener("mute", () => {
    if (!state.active || state.stream !== stream || state.muted) return;
    ui.toneCue.textContent = "Microphone reconnecting…";
    setStatus("Restoring your microphone…", "connecting");
  });
  track.addEventListener("unmute", () => {
    if (!state.active || state.stream !== stream || state.muted) return;
    void resumeListeningAfterIdle({ reason: "microphone" });
  });
  track.addEventListener("ended", () => {
    if (!state.active || state.stream !== stream) return;
    void recoverMicrophoneTrack();
  }, { once: true });
}

async function beginSession({ camera, mic }) {
  if (state.active) return;
  state.active = true;
  state.cameraOn = camera;
  state.micOn = mic;
  state.muted = false;
  ui.startButton.classList.add("danger");
  ui.startButton.querySelector("span").textContent = "End conversation";
  ui.startButton.querySelector("svg").innerHTML = '<path d="M8 8h8v8H8z" />';
  ui.cameraButton.disabled = !camera;
  ui.muteButton.disabled = !mic;
  ui.avatarHeadline.textContent = "I’m right here with you.";
  ui.avatarSubline.textContent = "Speak naturally. Pause whenever you need to—silence belongs in the conversation too.";
  setStatus("Opening a quiet space…", "connecting");
  startTimer();

  try {
    state.stream = await requestMedia(camera, mic);
    if (camera && state.stream) {
      ui.userVideo.srcObject = state.stream;
      ui.cameraPreview.hidden = false;
      await ui.userVideo.play();
      loadVisionModels();
    }
    if (mic && state.stream) {
      const activeStream = state.stream;
      const microphoneTrack = activeStream.getAudioTracks()[0];
      bindMicrophoneTrackHandlers(microphoneTrack, activeStream);
      await setupAudioInput({ rebuild: true });
      startAudioWatchdog();
    }
  } catch (error) {
    console.warn("Media permission unavailable", error);
    const message = error?.name === "NotAllowedError" ? "Camera or microphone permission was declined. Text mode is still ready." : "Camera or microphone couldn’t start. Text mode is still ready.";
    showToast(message);
    state.cameraOn = false;
    state.micOn = false;
    ui.cameraButton.disabled = true;
    ui.muteButton.disabled = true;
    ui.cameraPreview.hidden = true;
  }

  if (!state.liveConnected) await connectGemini({ automatic: true });
  setAvatarMode("listening");
  setStatus(state.liveConnected ? "Listening with Gemini Live" : "Listening locally", "active");
  if (state.liveConnected) startVisionLoop();
}

async function endSession({ quiet = false } = {}) {
  finishUserTranscription();
  if (state.suppressCurrentModelTurn || state.recoveringFallback) discardStreamingMessage();
  else finishStreamingMessage();
  state.suppressCurrentModelTurn = false;
  state.recoveringFallback = false;
  state.pendingUserText = "";
  state.active = false;
  state.cameraOn = false;
  state.micOn = false;
  state.muted = false;
  cancelAnimationFrame(state.visionRaf);
  state.visionRaf = null;
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  ui.userVideo.srcObject = null;
  ui.cameraPreview.hidden = true;
  ui.cameraButton.disabled = true;
  ui.muteButton.disabled = true;
  ui.cameraButton.classList.remove("off");
  ui.muteButton.classList.remove("off");
  cleanupAudioInput();
  stopAudioWatchdog();
  stopPlayback();
  window.speechSynthesis?.cancel();
  setAvatarMode("idle");
  stopTimer();
  ui.startButton.classList.remove("danger");
  ui.startButton.querySelector("span").textContent = "Begin a conversation";
  ui.startButton.querySelector("svg").innerHTML = '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21H8v2h8v-2h-3v-3.08A7 7 0 0 0 19 11h-2Z" />';
  ui.avatarHeadline.textContent = "A calm space to be heard.";
  ui.avatarSubline.textContent = "I’ll listen to your words and the little cues around them—at your pace.";
  ui.expressionCue.textContent = "Waiting for camera";
  ui.toneCue.textContent = "Waiting for microphone";
  ui.postureCue.textContent = "Waiting for camera";
  setStatus(state.liveConnected ? "Gemini connected — ready when you are" : "Ready when you are");
  if (!quiet) showToast(state.user ? "Conversation ended. Completed exchanges are in your Mira memory." : "Conversation ended. This private visit was not saved.");
}

async function setupAudioInput({ rebuild = false } = {}) {
  if (!state.stream?.getAudioTracks().length) return;
  if (rebuild) cleanupAudioInput();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!state.audioContext || state.audioContext.state === "closed") {
    try {
      state.audioContext = new AudioContext({ latencyHint: "interactive", sampleRate: 16000 });
    } catch (_) {
      state.audioContext = new AudioContext();
    }
  }
  state.audioContext.onstatechange = () => {
    if (
      state.active
      && state.micOn
      && !state.muted
      && document.visibilityState === "visible"
      && state.audioContext?.state !== "running"
    ) {
      void resumeListeningAfterIdle({ reason: "audio-context" });
    }
  };
  try { await state.audioContext.resume(); } catch (_) { /* retried by the watchdog */ }
  state.audioSource = state.audioContext.createMediaStreamSource(new MediaStream(state.stream.getAudioTracks()));
  state.audioProcessor = state.audioContext.createScriptProcessor(4096, 1, 1);
  state.silentGain = state.audioContext.createGain();
  state.silentGain.gain.value = 0;
  state.audioSource.connect(state.audioProcessor);
  state.audioProcessor.connect(state.silentGain);
  state.silentGain.connect(state.audioContext.destination);
  state.lastAudioProcessAt = Date.now();
  state.audioProcessor.onaudioprocess = (event) => {
    if (!state.active || state.muted) return;
    state.lastAudioProcessAt = Date.now();
    const samples = event.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    state.smoothedEnergy = state.smoothedEnergy * 0.82 + rms * 0.18;
    updateToneCue(state.smoothedEnergy);
    const liveSession = state.liveSession;
    if (liveSession) {
      try {
        liveSession.sendRealtimeInput({
          audio: {
            data: floatToPcmBase64(samples),
            mimeType: `audio/pcm;rate=${Math.round(state.audioContext.sampleRate)}`,
          },
        });
      } catch (error) {
        console.warn("Audio stream paused", error);
        handleLiveError("The microphone stream lost its live connection.", state.connectionId);
      }
    }
  };
}

function cleanupAudioInput() {
  if (state.audioProcessor) {
    state.audioProcessor.onaudioprocess = null;
    state.audioProcessor.disconnect();
  }
  state.audioSource?.disconnect();
  state.silentGain?.disconnect();
  state.audioProcessor = null;
  state.audioSource = null;
  state.silentGain = null;
  state.smoothedEnergy = 0;
}

function startAudioWatchdog() {
  clearInterval(state.audioWatchdogId);
  state.audioWatchdogId = setInterval(() => {
    if (!state.active || !state.micOn || state.muted || document.visibilityState !== "visible") return;
    const track = state.stream?.getAudioTracks()[0];
    const audioStalled = Date.now() - state.lastAudioProcessAt > AUDIO_STALL_LIMIT_MS;
    if (!track || track.readyState !== "live" || state.audioContext?.state !== "running" || audioStalled) {
      void resumeListeningAfterIdle({ reason: "watchdog" });
    }
  }, AUDIO_WATCHDOG_INTERVAL_MS);
}

function stopAudioWatchdog() {
  clearInterval(state.audioWatchdogId);
  state.audioWatchdogId = null;
  state.lastAudioProcessAt = 0;
}

async function recoverMicrophoneTrack() {
  if (state.microphoneRecoveryPromise) return state.microphoneRecoveryPromise;
  state.microphoneRecoveryPromise = (async () => {
    if (!state.active || !state.micOn || state.muted) return false;
    ui.toneCue.textContent = "Restoring microphone…";
    setStatus("Restoring your microphone…", "connecting");
    try {
      const microphoneStream = await requestMedia(false, true);
      const replacementTrack = microphoneStream?.getAudioTracks()[0];
      if (!replacementTrack) throw new Error("No microphone track was returned.");
      if (!state.active || !state.micOn) {
        replacementTrack.stop();
        return false;
      }
      const previousStream = state.stream;
      const videoTracks = previousStream?.getVideoTracks().filter((videoTrack) => videoTrack.readyState === "live") || [];
      const previousAudioTracks = previousStream?.getAudioTracks() || [];
      state.stream = new MediaStream([...videoTracks, replacementTrack]);
      previousAudioTracks.forEach((audioTrack) => audioTrack.stop());
      if (state.cameraOn) {
        ui.userVideo.srcObject = state.stream;
        await ui.userVideo.play().catch(() => {});
      }
      bindMicrophoneTrackHandlers(replacementTrack, state.stream);
      await setupAudioInput({ rebuild: true });
      startAudioWatchdog();
      ui.muteButton.disabled = false;
      ui.muteButton.classList.remove("off");
      ui.toneCue.textContent = "Listening…";
      setStatus(state.liveConnected ? "Listening with Gemini Live" : "Restoring voice connection…", state.liveConnected ? "active" : "connecting");
      return true;
    } catch (error) {
      console.warn("Microphone recovery failed", error);
      state.micOn = false;
      ui.muteButton.disabled = true;
      ui.muteButton.classList.add("off");
      ui.toneCue.textContent = "Tap Begin again to restore microphone";
      setStatus("Microphone needs your permission again", "connecting");
      showToast("Mira couldn’t restore the microphone automatically. End and begin once to allow it again.");
      return false;
    } finally {
      state.microphoneRecoveryPromise = null;
    }
  })();
  return state.microphoneRecoveryPromise;
}

async function refreshLiveConnectionAfterIdle() {
  const previousSession = state.liveSession;
  state.connectionId += 1;
  state.liveSession = null;
  state.liveConnected = false;
  state.connecting = false;
  state.connectionPromise = null;
  state.reconnectAttempts = 0;
  try { previousSession?.close(); } catch (_) { /* replaced after inactivity */ }
  const connected = await connectGemini({ automatic: true });
  if (!connected) scheduleGeminiReconnect();
  return connected;
}

async function resumeListeningAfterIdle({ reason = "return", hiddenFor = 0 } = {}) {
  if (state.idleResumePromise) return state.idleResumePromise;
  state.idleResumePromise = (async () => {
    if (!state.active || !state.micOn || state.muted) return false;
    const track = state.stream?.getAudioTracks()[0];
    const audioStalled = Date.now() - state.lastAudioProcessAt > AUDIO_STALL_LIMIT_MS;
    if (!track || track.readyState !== "live" || (track.muted && audioStalled)) {
      if (!await recoverMicrophoneTrack()) return false;
    } else {
      try { await state.audioContext?.resume(); } catch (_) { /* rebuild below */ }
      if (!state.audioProcessor || state.audioContext?.state !== "running" || audioStalled) {
        await setupAudioInput({ rebuild: true });
      }
    }

    state.reconnectAttempts = 0;
    if (hiddenFor >= LIVE_IDLE_REFRESH_MS) await refreshLiveConnectionAfterIdle();
    else if (!state.liveConnected) {
      const connected = await connectGemini({ automatic: true });
      if (!connected) scheduleGeminiReconnect();
    }

    ui.toneCue.textContent = "Listening…";
    setStatus(state.liveConnected ? "Listening with Gemini Live" : "Listening while voice reconnects", state.liveConnected ? "active" : "connecting");
    if ((reason === "visibility" || reason === "focus" || reason === "pageshow") && hiddenFor > 0) {
      showToast("Welcome back — Mira is listening again.");
    }
    return true;
  })();
  try {
    return await state.idleResumePromise;
  } finally {
    state.idleResumePromise = null;
  }
}

function floatToPcmBase64(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function updateToneCue(energy) {
  let label = "Quiet / settling in";
  if (energy > 0.075) label = "Animated energy";
  else if (energy > 0.032) label = "Steady voice";
  else if (energy > 0.011) label = "Soft voice";
  state.tone = label;
  ui.toneCue.textContent = label;
  ui.toneCue.closest(".cue-card").classList.toggle("detected", energy > 0.008);
  if (energy > 0.018 && state.active && !ui.avatarStage.classList.contains("speaking")) setAvatarMode("listening");
}

async function loadVisionModels() {
  if (state.faceLandmarker && state.poseLandmarker) {
    startVisionLoop();
    return;
  }
  ui.expressionCue.textContent = "Preparing local vision…";
  ui.postureCue.textContent = "Preparing local vision…";
  try {
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm");
    const resolver = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
    const [face, pose] = await Promise.all([
      vision.FaceLandmarker.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        minFaceDetectionConfidence: 0.45,
        minTrackingConfidence: 0.45,
      }),
      vision.PoseLandmarker.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.45,
        minTrackingConfidence: 0.45,
      }),
    ]);
    state.faceLandmarker = face;
    state.poseLandmarker = pose;
    if (state.active && state.cameraOn) startVisionLoop();
  } catch (error) {
    console.warn("Local vision unavailable", error);
    ui.expressionCue.textContent = "Vision unavailable";
    ui.postureCue.textContent = "Vision unavailable";
    showToast("Local visual cues couldn’t load. Camera can still support Gemini Live.");
  }
}

function startVisionLoop() {
  cancelAnimationFrame(state.visionRaf);
  const loop = () => {
    if (!state.active || !state.cameraOn) return;
    const now = performance.now();
    if (ui.userVideo.readyState >= 2 && now - state.lastVisionAt > 180) {
      state.lastVisionAt = now;
      analyzeFrame(now);
    }
    if (state.liveSession && ui.userVideo.readyState >= 2 && now - state.lastVideoSentAt > 1000) {
      state.lastVideoSentAt = now;
      sendVideoFrame();
    }
    state.visionRaf = requestAnimationFrame(loop);
  };
  state.visionRaf = requestAnimationFrame(loop);
}

function analyzeFrame(timestamp) {
  try {
    if (state.faceLandmarker) {
      const face = state.faceLandmarker.detectForVideo(ui.userVideo, timestamp);
      updateExpressionCue(face);
    }
    if (state.poseLandmarker) {
      const pose = state.poseLandmarker.detectForVideo(ui.userVideo, timestamp);
      updatePostureCue(pose);
    }
  } catch (error) {
    console.warn("Frame analysis skipped", error);
  }
}

function average(map, ...keys) {
  const values = keys.map((key) => map[key] || 0);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function updateExpressionCue(result) {
  const categories = result?.faceBlendshapes?.[0]?.categories;
  if (!categories?.length) {
    state.expression = "Face not in view";
    ui.expressionCue.textContent = state.expression;
    ui.expressionCue.closest(".cue-card").classList.remove("detected");
    return;
  }
  const scores = Object.fromEntries(categories.map((item) => [item.categoryName, item.score]));
  const smile = average(scores, "mouthSmileLeft", "mouthSmileRight");
  const frown = average(scores, "mouthFrownLeft", "mouthFrownRight");
  const browConcern = (scores.browInnerUp || 0) + average(scores, "browDownLeft", "browDownRight") * 0.45;
  const eyesWide = average(scores, "eyeWideLeft", "eyeWideRight");
  const blink = average(scores, "eyeBlinkLeft", "eyeBlinkRight");
  const pressed = average(scores, "mouthPressLeft", "mouthPressRight");
  let label = "Calm / neutral";
  if (smile > 0.42) label = "A gentle smile";
  else if (eyesWide > 0.38 && (scores.jawOpen || 0) > 0.25) label = "A moment of surprise";
  else if (browConcern > 0.52 && frown > 0.12) label = "A thoughtful look";
  else if (pressed > 0.38 || frown > 0.34) label = "A little tension";
  else if (blink > 0.72) label = "A quiet pause";
  state.expression = label;
  ui.expressionCue.textContent = label;
  ui.expressionCue.closest(".cue-card").classList.add("detected");
  updateReflection();
}

function pointVisible(point) {
  return point && (point.visibility === undefined || point.visibility > 0.42);
}

function updatePostureCue(result) {
  const points = result?.landmarks?.[0];
  if (!points?.length || !pointVisible(points[11]) || !pointVisible(points[12])) {
    state.posture = "Upper body not in view";
    ui.postureCue.textContent = state.posture;
    ui.postureCue.closest(".cue-card").classList.remove("detected");
    return;
  }
  const leftShoulder = points[11];
  const rightShoulder = points[12];
  const leftWrist = points[15];
  const rightWrist = points[16];
  const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y);
  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x) || 0.2;
  const centered = Math.abs(((leftShoulder.x + rightShoulder.x) / 2) - 0.5) < 0.13;
  const handsVisible = pointVisible(leftWrist) && pointVisible(rightWrist);
  const armsFolded = handsVisible && leftWrist.x < rightShoulder.x && rightWrist.x > leftShoulder.x && Math.abs(leftWrist.y - rightWrist.y) < shoulderWidth;
  let label = "Open / settled";
  if (armsFolded) label = "A contained posture";
  else if (shoulderTilt > 0.075) label = "Shifting / adjusting";
  else if (!centered) label = "Leaning to one side";
  state.posture = label;
  ui.postureCue.textContent = label;
  ui.postureCue.closest(".cue-card").classList.add("detected");
  updateReflection();
}

function updateReflection() {
  let text = "I’m noticing a steady presence. There’s no need to perform here—just be as you are.";
  if (state.expression.includes("smile")) text = "There’s a little warmth in your expression. We can stay with whatever brought it forward.";
  else if (state.expression.includes("tension") || state.posture.includes("contained")) text = "I may be reading this wrong, but something looks a little held back. We can take it slowly.";
  else if (state.expression.includes("thoughtful")) text = "You seem to be sitting with something. I’ll give it room instead of rushing to fill the silence.";
  else if (state.tone.includes("Soft")) text = "Your voice is soft just now. I’m listening closely, and there’s no need to push.";
  ui.reflectionText.textContent = text;
}

function sendVideoFrame() {
  const canvas = ui.frameCanvas;
  const width = 320;
  const ratio = ui.userVideo.videoHeight / ui.userVideo.videoWidth || 0.75;
  canvas.width = width;
  canvas.height = Math.round(width * ratio);
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(ui.userVideo, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL("image/jpeg", 0.56).split(",")[1];
  try {
    state.liveSession?.sendRealtimeInput({ video: { data, mimeType: "image/jpeg" } });
  } catch (error) {
    console.warn("Video frame skipped", error);
  }
}

async function connectGemini(options = {}) {
  if (state.liveConnected) return true;
  if (state.connectionPromise) return state.connectionPromise;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.connectionPromise = openGeminiConnection(options);
  try {
    return await state.connectionPromise;
  } finally {
    state.connectionPromise = null;
  }
}

async function openGeminiConnection({ automatic = false } = {}) {
  const connectionId = ++state.connectionId;
  state.tokenRequestAttempted = true;
  state.connecting = true;
  ui.connectButton.classList.add("loading");
  ui.connectButton.hidden = true;
  ui.connectButton.textContent = "Connecting…";
  ui.geminiStatusHeading.textContent = automatic ? "Connecting automatically…" : "Reconnecting…";
  ui.connectionNote.textContent = "Securing a one-use, short-lived token for this visit.";
  setStatus("Connecting Gemini Live…", "connecting");
  try {
    const tokenResponse = await fetch(GEMINI_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      credentials: GEMINI_TOKEN_ENDPOINT.startsWith("/") ? "same-origin" : "omit",
    });
    const tokenPayload = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenPayload.token) {
      const error = new Error(tokenPayload.error || "Mira could not request a Gemini session token.");
      error.status = tokenResponse.status;
      throw error;
    }
    const genai = await import("https://esm.sh/@google/genai?bundle");
    const ai = new genai.GoogleGenAI({ apiKey: tokenPayload.token });
    const config = {
      responseModalities: [genai.Modality.AUDIO],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      systemInstruction: systemInstructionWithMemory(),
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: state.liveSessionHandle ? { handle: state.liveSessionHandle } : {},
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      realtimeInputConfig: {
        automaticActivityDetection: {
          disabled: false,
          prefixPaddingMs: 120,
          silenceDurationMs: 650,
        },
      },
    };
    if (genai.MediaResolution?.MEDIA_RESOLUTION_LOW) config.mediaResolution = genai.MediaResolution.MEDIA_RESOLUTION_LOW;
    const session = await ai.live.connect({
      model: "gemini-3.8-live",
      config,
      callbacks: {
        onopen: () => {},
        onmessage: (message) => handleLiveMessage(message, connectionId),
        onerror: (event) => handleLiveError(event?.message || "The live session reported an error.", connectionId),
        onclose: () => {
          if (state.liveConnected && state.connectionId === connectionId) {
            handleLiveError("The live session ended unexpectedly.", connectionId);
          }
        },
      },
    });
    if (state.connectionId !== connectionId) {
      try { session.close(); } catch (_) { /* superseded connection */ }
      return false;
    }
    state.liveSession = session;
    state.liveConnected = true;
    state.connecting = false;
    state.reconnectAttempts = 0;
    ui.connectButton.classList.remove("loading");
    ui.connectButton.hidden = true;
    ui.connectButton.textContent = "Retry Gemini Live";
    ui.geminiStatusHeading.textContent = "Connected";
    ui.connectionNote.textContent = "Gemini Live is ready. Mira will listen when you begin a conversation.";
    setStatus(state.active ? "Listening with Gemini Live" : "Gemini connected — ready when you are", "active");
    if (!automatic) showToast("Gemini Live reconnected securely.");
    if (state.active && state.cameraOn) startVisionLoop();
    return true;
  } catch (error) {
    if (state.connectionId !== connectionId) return false;
    console.warn("Gemini connection failed", error);
    state.connecting = false;
    state.liveConnected = false;
    state.liveSession = null;
    ui.connectButton.classList.remove("loading");
    ui.connectButton.hidden = false;
    ui.connectButton.textContent = "Try Gemini Live again";
    ui.geminiStatusHeading.textContent = "Local mode active";
    ui.connectionNote.textContent = friendlyConnectionError(error);
    setStatus(state.active ? "Listening locally" : "Ready when you are", state.active ? "active" : "idle");
    if (automatic) showToast("Gemini is unavailable just now. Mira is continuing locally.");
    return false;
  }
}

function friendlyConnectionError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (error?.status === 429 || message.includes("quota") || message.includes("429")) return "The free-tier quota is resting. Try again later or continue in local mode.";
  if (error?.status === 403 || message.includes("403")) return "Mira’s secure Gemini connection is temporarily unavailable. Local mode remains ready.";
  if (message.includes("model") || message.includes("not found")) return "Gemini Live isn’t available to this project yet. Local mode remains available.";
  return "Couldn’t open a live connection. Check the key and network, or continue in local mode.";
}

function scheduleGeminiReconnect() {
  if (state.reconnectTimer || state.connecting || state.liveConnected || (!state.user && !state.guest)) return;
  if (state.reconnectAttempts >= 3) {
    ui.connectionNote.textContent = "Automatic reconnection paused after three tries. Text mode still works, or use Retry Gemini Live.";
    ui.connectButton.hidden = false;
    ui.connectButton.textContent = "Try Gemini Live again";
    return;
  }
  const delay = Math.min(1000 * (2 ** state.reconnectAttempts), 4000);
  state.reconnectAttempts += 1;
  ui.geminiStatusHeading.textContent = "Reconnecting automatically…";
  ui.connectionNote.textContent = "Mira is restoring the live conversation after a brief interruption.";
  setStatus("Restoring voice connection…", "connecting");
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    const connected = await connectGemini({ automatic: true });
    if (!connected) scheduleGeminiReconnect();
  }, delay);
}

function handleLiveError(message, connectionId = state.connectionId) {
  if (connectionId !== state.connectionId) return;
  console.warn("Gemini Live", message);
  state.connectionId += 1;
  state.liveConnected = false;
  state.connecting = false;
  try { state.liveSession?.close(); } catch (_) { /* already closed */ }
  state.liveSession = null;
  ui.geminiStatusHeading.textContent = "Local mode active";
  ui.connectionNote.textContent = "The live connection paused. Mira is restoring it automatically; text responses still work.";
  ui.connectButton.hidden = false;
  ui.connectButton.textContent = "Try Gemini Live again";
  finishUserTranscription();
  if (state.suppressCurrentModelTurn || state.recoveringFallback) discardStreamingMessage();
  else finishStreamingMessage();
  state.suppressCurrentModelTurn = false;
  state.recoveringFallback = false;
  state.pendingUserText = "";
  stopPlayback();
  setStatus(state.active ? "Listening locally" : "Ready when you are", state.active ? "active" : "idle");
  showToast("The voice connection paused. Mira is reconnecting automatically.");
  scheduleGeminiReconnect();
}

function handleLiveMessage(message, connectionId = state.connectionId) {
  if (connectionId !== state.connectionId) return;
  const resumption = message?.sessionResumptionUpdate;
  if (resumption?.resumable && resumption.newHandle) state.liveSessionHandle = resumption.newHandle;
  if (message?.goAway) {
    handleLiveError("Gemini requested a routine connection refresh.", connectionId);
    return;
  }
  const content = message?.serverContent;
  if (!content) return;
  if (content.interrupted) {
    stopPlayback();
    finishUserTranscription();
    if (state.suppressCurrentModelTurn || state.recoveringFallback) discardStreamingMessage();
    else finishStreamingMessage();
    state.suppressCurrentModelTurn = false;
    state.recoveringFallback = false;
    state.pendingUserText = "";
  }
  if (content.inputTranscription?.text && !state.recoveringFallback) {
    state.userTranscript += content.inputTranscription.text;
    updateUserTranscription(state.userTranscript.trim());
  }
  if (content.outputTranscription?.text) {
    state.modelTranscript += content.outputTranscription.text;
    if (!state.suppressCurrentModelTurn && isGenericModelFallback(state.modelTranscript)) {
      state.suppressCurrentModelTurn = true;
      stopPlayback();
      state.transcriptNode?.remove();
      state.transcriptNode = null;
    }
    if (!state.suppressCurrentModelTurn) {
      if (state.active && state.micOn && !state.userTranscriptNode && !state.recoveringFallback) updateUserTranscription("");
      updateStreamingMessage(state.modelTranscript.trim());
    }
  }
  for (const part of content.modelTurn?.parts || []) {
    if (part.inlineData?.data && !state.suppressCurrentModelTurn) playPcmAudio(part.inlineData.data, 24000);
  }
  if (content.turnComplete) {
    const completedUserText = state.userTranscript.trim() || state.pendingUserText;
    const completedMiraText = state.modelTranscript.trim();
    finishUserTranscription();
    if (state.suppressCurrentModelTurn) {
      discardStreamingMessage();
      state.suppressCurrentModelTurn = false;
      if (state.recoveringFallback) {
        state.recoveringFallback = false;
        state.pendingUserText = "";
        void deliverWarmBoundaryFallback(completedUserText);
      } else {
        void requestWarmFallbackRecovery(completedUserText);
      }
      return;
    }
    finishStreamingMessage();
    state.pendingUserText = "";
    state.recoveringFallback = false;
    void saveConversationTurn(completedUserText, completedMiraText);
    setStatus("Listening with Gemini Live", "active");
  }
}

function playPcmAudio(base64, sampleRate) {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  state.audioContext ||= new AudioContext();
  state.audioContext.resume();
  const binary = atob(base64);
  const byteLength = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i += 1) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const sampleCount = byteLength / 2;
  const buffer = state.audioContext.createBuffer(1, sampleCount, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768;
  const source = state.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(state.audioContext.destination);
  const startsAt = Math.max(state.audioContext.currentTime + 0.03, state.playbackTime);
  state.playbackTime = startsAt + buffer.duration;
  state.playbackSources.add(source);
  source.onended = () => {
    state.playbackSources.delete(source);
    if (!state.playbackSources.size) {
      setAvatarMode("listening");
      if (state.active) setStatus("Listening with Gemini Live", "active");
    }
  };
  setAvatarMode("speaking");
  setStatus("Mira is responding", "active");
  source.start(startsAt);
}

function stopPlayback() {
  state.playbackSources.forEach((source) => {
    try { source.stop(); } catch (_) { /* already stopped */ }
  });
  state.playbackSources.clear();
  state.playbackTime = state.audioContext?.currentTime || 0;
  if (state.active) setAvatarMode("listening");
}

function toggleCamera() {
  const track = state.stream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  state.cameraOn = track.enabled;
  ui.cameraButton.classList.toggle("off", !track.enabled);
  ui.cameraPreview.hidden = !track.enabled;
  if (track.enabled) startVisionLoop();
  else {
    cancelAnimationFrame(state.visionRaf);
    ui.expressionCue.textContent = "Camera paused";
    ui.postureCue.textContent = "Camera paused";
  }
}

function toggleMute() {
  const track = state.stream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  state.muted = !track.enabled;
  ui.muteButton.classList.toggle("off", state.muted);
  ui.toneCue.textContent = state.muted ? "Microphone paused" : "Listening…";
  if (!state.muted) {
    void state.audioContext?.resume();
    if (!state.liveConnected) scheduleGeminiReconnect();
  }
}

async function resetEverything() {
  await endSession({ quiet: true });
  state.connectionId += 1;
  try { state.liveSession?.close(); } catch (_) { /* already closed */ }
  state.liveSession = null;
  state.liveConnected = false;
  state.connectionPromise = null;
  state.liveSessionHandle = "";
  state.reconnectAttempts = 0;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.tokenRequestAttempted = false;
  state.faceLandmarker?.close();
  state.poseLandmarker?.close();
  state.faceLandmarker = null;
  state.poseLandmarker = null;
  ui.conversation.innerHTML = '<div class="message mira-message"><span class="message-author">Mira</span><p>I’m here. We can talk, sit quietly, or start with one small thing that’s on your mind.</p></div>';
  state.userTranscript = "";
  state.userTranscriptNode = null;
  state.modelTranscript = "";
  state.transcriptNode = null;
  state.suppressCurrentModelTurn = false;
  state.recoveringFallback = false;
  state.pendingUserText = "";
  ui.reflectionText.textContent = "Nothing is being judged. These are gentle, momentary cues—not conclusions about how you feel.";
  ui.connectButton.hidden = true;
  ui.connectButton.textContent = "Retry Gemini Live";
  ui.geminiStatusHeading.textContent = "Connecting automatically…";
  ui.connectionNote.textContent = "Securing a new one-use token after the reset.";
  showToast("Session reset. Camera, microphone, and conversation were cleared.");
  await connectGemini({ automatic: true });
}

ui.startButton.addEventListener("click", () => {
  if (state.active) endSession();
  else safeShowModal(ui.consentDialog);
});

ui.allowButton.addEventListener("click", (event) => {
  event.preventDefault();
  ui.consentDialog.close();
  beginSession({ camera: ui.cameraConsent.checked, mic: ui.micConsent.checked });
});

ui.textOnlyButton.addEventListener("click", () => {
  ui.consentDialog.close();
  beginSession({ camera: false, mic: false });
});

ui.messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitText(ui.messageInput.value);
});

ui.settingsButton.addEventListener("click", () => safeShowModal(ui.settingsDialog));
ui.accountButton.addEventListener("click", () => {
  if (state.user) safeShowModal(ui.memoryDialog);
  else safeShowModal(ui.signinDialog);
});
ui.privacyButton.addEventListener("click", () => safeShowModal(ui.privacyDialog));
ui.resetButton.addEventListener("click", resetEverything);
ui.cameraButton.addEventListener("click", toggleCamera);
ui.muteButton.addEventListener("click", toggleMute);

ui.connectButton.addEventListener("click", () => connectGemini());
ui.googleSignInButton.addEventListener("click", signInWithGoogle);
ui.guestButton.addEventListener("click", async () => {
  state.guest = true;
  state.user = null;
  await finishIdentityChoice();
  showToast("Private visit active. Nothing from this visit will be retained.");
});
ui.manageMemoryButton.addEventListener("click", () => {
  ui.settingsDialog.close();
  safeShowModal(state.user ? ui.memoryDialog : ui.signinDialog);
});
ui.memoryCloseButton.addEventListener("click", () => ui.memoryDialog.close());
ui.eraseMemoryButton.addEventListener("click", eraseAllMemories);
ui.signOutButton.addEventListener("click", async () => {
  await endSession({ quiet: true });
  state.connectionId += 1;
  try { state.liveSession?.close(); } catch (_) { /* already closed */ }
  state.liveSession = null;
  state.liveConnected = false;
  state.liveSessionHandle = "";
  state.reconnectAttempts = 0;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.memories = [];
  state.user = null;
  state.guest = false;
  await signOut(state.auth);
  ui.settingsDialog.close();
  setAccountUi();
  safeShowModal(ui.signinDialog);
  showToast("Signed out. Mira’s saved memory remains private to your account.");
});

for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

ui.signinDialog.addEventListener("cancel", (event) => event.preventDefault());

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    state.hiddenAt = Date.now();
    return;
  }
  const hiddenFor = state.hiddenAt ? Date.now() - state.hiddenAt : 0;
  state.hiddenAt = 0;
  void resumeListeningAfterIdle({ reason: "visibility", hiddenFor });
});

window.addEventListener("focus", () => {
  const hiddenFor = state.hiddenAt ? Date.now() - state.hiddenAt : 0;
  state.hiddenAt = 0;
  void resumeListeningAfterIdle({ reason: "focus", hiddenFor });
});

window.addEventListener("pageshow", () => {
  void resumeListeningAfterIdle({ reason: "pageshow" });
});

window.addEventListener("online", () => {
  void resumeListeningAfterIdle({ reason: "online" });
});

window.addEventListener("beforeunload", () => {
  state.connectionId += 1;
  clearTimeout(state.reconnectTimer);
  stopAudioWatchdog();
  state.stream?.getTracks().forEach((track) => track.stop());
  try { state.liveSession?.close(); } catch (_) { /* page is closing */ }
});

if (!navigator.mediaDevices?.getUserMedia) {
  ui.startButton.querySelector("span").textContent = "Begin with text";
  ui.cameraConsent.checked = false;
  ui.micConsent.checked = false;
}

setAccountUi();
void initializeIdentity();
