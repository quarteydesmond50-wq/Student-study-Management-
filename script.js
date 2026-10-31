// ── Auth guard — redirect to login if no valid session ────────────────────────
// Runs after DOM is ready so the page never goes blank on a slow network.
document.addEventListener("DOMContentLoaded", async () => {
  // Skip guard when opened directly as a file (no server running)
  if (window.location.protocol === "file:") return;
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (res.status === 401) {
      window.location.replace("login.html");
    }
  } catch (_) {
    // Network error — server likely not running; allow offline use
  }
});

const STORAGE_KEY = "studentStudyPlannerTasks";
const LECTURES_STORAGE_KEY = "studentStudyPlannerLectures";
const tasks = [];
const lectures = [];

const $ = (selector) => document.querySelector(selector);
const taskList = $("#task-list");
const form = $("#task-form");
const titleInput = $("#task-title");
const subjectInput = $("#task-subject");
const priorityInput = $("#task-priority");
const modal = $("#task-modal");
const toast = $("#toast");
const lectureForm = $("#lecture-form");
const lectureModal = $("#lecture-modal");
const lectureTitleInput = $("#lecture-title");
const lectureCourseInput = $("#lecture-course");
const lectureDateInput = $("#lecture-date");
let lastFocusedElement = null;
let currentView = "tasks";
let studyRemainingSeconds = 25 * 60;
let studyTimerInterval = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(saved)) throw new TypeError("Saved tasks must be a list.");

    return saved.filter((task) =>
      task &&
      typeof task.id === "string" &&
      typeof task.title === "string" &&
      typeof task.subject === "string" &&
      typeof task.completed === "boolean"
    ).map((task) => ({
      ...task,
      priority: ["High", "Medium", "Low"].includes(task.priority) ? task.priority : "Medium"
    }));
  } catch (error) {
    console.error("Could not load saved study tasks:", error);
    showToast("Saved tasks could not be loaded. You can still add tasks in this session.");
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    return true;
  } catch (error) {
    console.error("Could not save study tasks:", error);
    showToast("Your change could not be saved in this browser.");
    return false;
  }
}

function loadLectures() {
  try {
    const saved = JSON.parse(localStorage.getItem(LECTURES_STORAGE_KEY) || "[]");
    if (!Array.isArray(saved)) throw new TypeError("Saved lectures must be a list.");

    return saved.filter((lecture) =>
      lecture &&
      typeof lecture.id === "string" &&
      typeof lecture.title === "string" &&
      typeof lecture.course === "string" &&
      (typeof lecture.date === "string" || lecture.date === "")
    );
  } catch (error) {
    console.error("Could not load saved lectures:", error);
    showToast("Saved lectures could not be loaded. You can still add lectures in this session.");
    return [];
  }
}

function saveLectures() {
  try {
    localStorage.setItem(LECTURES_STORAGE_KEY, JSON.stringify(lectures));
    return true;
  } catch (error) {
    console.error("Could not save lectures:", error);
    showToast("Your lecture could not be saved in this browser.");
    return false;
  }
}

function createId() {
  return window.crypto && typeof window.crypto.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatLectureDate(date) {
  if (!date) return "Date not set";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function renderLectures() {
  const sortedLectures = [...lectures].sort((first, second) =>
    (first.date || "9999-12-31").localeCompare(second.date || "9999-12-31") ||
    first.title.localeCompare(second.title)
  );
  $("#lecture-list").innerHTML = sortedLectures.length
    ? sortedLectures.map((lecture) => `
      <li class="lecture-item">
        <span class="lecture-icon" aria-hidden="true">▤</span>
        <span class="lecture-copy">
          <strong>${escapeHtml(lecture.title)}</strong>
          <span>${escapeHtml(lecture.course)} · ${escapeHtml(formatLectureDate(lecture.date))}</span>
        </span>
        <button class="delete-button lecture-delete" type="button" data-lecture-action="delete" data-lecture-id="${escapeHtml(lecture.id)}" aria-label="Delete lecture ${escapeHtml(lecture.title)}" title="Delete lecture">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2m3 0-.7 10H5.7L5 6m3 3v4m4-4v4"/></svg>
        </button>
      </li>
    `).join("")
    : '<li class="study-empty-message">No lectures added yet. Add a lecture to keep your study topics organized.</li>';
}

function renderTask(task) {
  const isCompleted = task.completed;
  return `
    <li class="task-item ${isCompleted ? "completed" : ""}">
      <button
        class="task-toggle"
        type="button"
        data-action="toggle"
        data-task-id="${escapeHtml(task.id)}"
        aria-pressed="${isCompleted}"
        aria-label="${isCompleted ? "Mark incomplete" : "Mark complete"}: ${escapeHtml(task.title)}"
        title="${isCompleted ? "Mark incomplete" : "Mark complete"}"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3.2 3.2L13 4.5"/></svg>
      </button>
      <div class="task-copy">
        <span class="task-title">${escapeHtml(task.title)}</span>
        <span class="task-subject">${escapeHtml(task.subject)}</span>
      </div>
      <span class="priority-tag ${task.priority.toLowerCase()}">${escapeHtml(task.priority)}</span>
      <div class="task-actions">
        <button class="complete-button ${isCompleted ? "undo" : ""}" type="button" data-action="toggle" data-task-id="${escapeHtml(task.id)}">
          ${isCompleted ? "Mark Incomplete" : "Mark Complete"}
        </button>
        <button class="delete-button" type="button" data-action="delete" data-task-id="${escapeHtml(task.id)}" aria-label="Delete ${escapeHtml(task.title)}" title="Delete task">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2m3 0-.7 10H5.7L5 6m3 3v4m4-4v4"/></svg>
        </button>
      </div>
    </li>
  `;
}

function render() {
  const isEmpty = tasks.length === 0;
  $("#empty-state").hidden = !isEmpty;
  taskList.innerHTML = tasks.map(renderTask).join("");
  $("#result-count").textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
  $("#task-view").hidden            = currentView !== "tasks";
  $("#study-dashboard-view").hidden = currentView !== "study-dashboard";
  $("#insights-view").hidden        = currentView !== "insights";
  $("#students-view").hidden        = currentView !== "students";
  $("#attendance-view").hidden      = currentView !== "attendance";
  document.querySelectorAll(".nav-link[data-view]").forEach((button) => {
    const active = button.dataset.view === currentView;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  renderStudyDashboard();
  renderInsights();
  renderLectures();
  if (currentView === "students")   loadStudentsView();
  if (currentView === "attendance") loadAttendanceView();
}

function getCourseGroups() {
  const groups = new Map();
  tasks.forEach((task) => {
    if (!groups.has(task.subject)) groups.set(task.subject, []);
    groups.get(task.subject).push(task);
  });
  return [...groups.entries()].sort(([first], [second]) => first.localeCompare(second));
}

function renderStudyDashboard() {
  const openTasks = tasks.filter((task) => !task.completed);
  const priorityOrder = { High: 0, Medium: 1, Low: 2 };
  const priorityTasks = [...openTasks].sort((first, second) =>
    priorityOrder[first.priority] - priorityOrder[second.priority] ||
    first.title.localeCompare(second.title)
  ).slice(0, 3);

  $("#recommendation-copy").textContent = openTasks.length
    ? `Generate a suggestion based on your ${openTasks.length} open ${openTasks.length === 1 ? "task" : "tasks"}, starting with the highest priority.`
    : tasks.length
      ? "Everything is complete. Add another task whenever you are ready for your next study goal."
      : "Get a focused suggestion based on your current tasks and priorities.";

  $("#priority-task-list").innerHTML = priorityTasks.length
    ? priorityTasks.map((task) => `
      <li class="priority-task-item">
        <button class="priority-toggle" type="button" data-action="toggle" data-task-id="${escapeHtml(task.id)}" aria-pressed="false" aria-label="Mark complete: ${escapeHtml(task.title)}">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3.2 3.2L13 4.5"/></svg>
        </button>
        <span class="priority-task-copy">
          <span class="priority-task-title">${escapeHtml(task.title)}</span>
          <span class="priority-task-subject">${escapeHtml(task.subject)}</span>
        </span>
        <span class="priority-task-meta"><span class="priority-tag ${task.priority.toLowerCase()}">${escapeHtml(task.priority)}</span></span>
      </li>
    `).join("")
    : '<li class="study-empty-message">No open tasks. Add a task to build your study plan.</li>';

  const courseGroups = getCourseGroups();
  $("#course-grid").innerHTML = courseGroups.length
    ? courseGroups.map(([subject, courseTasks]) => {
      const completed = courseTasks.filter((task) => task.completed).length;
      const percentage = Math.round((completed / courseTasks.length) * 100);
      return `
        <article class="course-card">
          <div class="course-card-header"><h3>${escapeHtml(subject)}</h3><span class="course-card-percent">${percentage}%</span></div>
          <p>${completed} of ${courseTasks.length} ${courseTasks.length === 1 ? "task" : "tasks"} complete</p>
          <div class="course-progress-track" role="progressbar" aria-label="${escapeHtml(subject)} task completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}"><span style="width: ${percentage}%"></span></div>
        </article>
      `;
    }).join("")
    : '<p class="study-empty-message">Your courses will appear here when you add tasks with a subject.</p>';

  const sessionCourse = $("#session-course");
  const selectedCourse = sessionCourse.value;
  const sessionCourses = [...new Set([
    ...courseGroups.map(([subject]) => subject),
    ...lectures.map((lecture) => lecture.course)
  ])].sort((first, second) => first.localeCompare(second));
  sessionCourse.innerHTML = '<option value="">Select a course</option>' +
    sessionCourses.map((subject) => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join("");
  sessionCourse.value = sessionCourses.includes(selectedCourse) ? selectedCourse : "";
  sessionCourse.disabled = Boolean(studyTimerInterval);
  $("#session-duration").disabled = Boolean(studyTimerInterval);
  $("#toggle-session").disabled = !sessionCourse.value;
  if (studyTimerInterval) {
    $("#toggle-session").innerHTML = '<span aria-hidden="true">Ⅱ</span> Pause';
  } else if (studyRemainingSeconds < Number($("#session-duration").value) * 60) {
    $("#toggle-session").innerHTML = '<span aria-hidden="true">▶</span> Resume';
  } else {
    $("#toggle-session").innerHTML = '<span aria-hidden="true">▶</span> Start';
  }

  const completedCount = tasks.filter((task) => task.completed).length;
  const completionRate = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;
  $("#dashboard-completed-count").textContent = `${completedCount}/${tasks.length}`;
  $("#dashboard-progress-fill").style.width = `${completionRate}%`;
  $(".progress-panel .course-progress-track").setAttribute("aria-valuenow", String(completionRate));
  $("#dashboard-progress-caption").textContent = tasks.length
    ? `${completionRate}% of your study tasks are complete.`
    : "Add a task to start tracking your progress.";
}

function renderInsights() {
  const completedCount = tasks.filter((task) => task.completed).length;
  const completionRate = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;
  const ring = $("#insight-completion-ring");
  ring.style.setProperty("--insight-percent", `${completionRate}%`);
  ring.setAttribute("aria-label", `${completionRate}% of tasks completed`);
  $("#insight-completion-percent").textContent = `${completionRate}%`;
  $("#insight-completion-detail").textContent = `${completedCount} of ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} completed`;

  const courseProgress = getCourseGroups().map(([subject, courseTasks]) => ({
    subject,
    percentage: Math.round((courseTasks.filter((task) => task.completed).length / courseTasks.length) * 100)
  })).sort((first, second) => second.percentage - first.percentage || first.subject.localeCompare(second.subject));
  $("#insight-course-count").textContent = courseProgress.length;
  $("#insight-course-list").innerHTML = courseProgress.length
    ? courseProgress.slice(0, 3).map(({ subject, percentage }) => `
      <div class="insight-course-row">
        <span class="insight-course-name">${escapeHtml(subject)}</span>
        <span class="insight-course-value">${percentage}%</span>
        <span class="insight-bar" role="progressbar" aria-label="${escapeHtml(subject)} completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}"><span style="width: ${percentage}%"></span></span>
      </div>
    `).join("")
    : '<p class="insight-empty">Add tasks with a course name to see course progress.</p>';

  const openTasks = tasks.filter((task) => !task.completed);
  const priorityCounts = ["High", "Medium", "Low"].map((priority) => ({
    priority,
    count: openTasks.filter((task) => task.priority === priority).length
  }));
  const largestCount = Math.max(1, ...priorityCounts.map(({ count }) => count));
  $("#insight-open-count").textContent = openTasks.length;
  $("#insight-priority-breakdown").innerHTML = priorityCounts.map(({ priority, count }) => `
    <div class="priority-row">
      <span class="priority-row-label">${priority} priority</span>
      <span class="insight-bar" role="img" aria-label="${count} ${priority.toLowerCase()} priority ${count === 1 ? "task" : "tasks"}"><span style="width: ${Math.round((count / largestCount) * 100)}%"></span></span>
      <span class="priority-row-count">${count}</span>
    </div>
  `).join("");
}

function updateStudyTimer() {
  const minutes = Math.floor(studyRemainingSeconds / 60);
  const seconds = studyRemainingSeconds % 60;
  $("#study-timer").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const fullDuration = Number($("#session-duration").value) * 60;
  const progress = fullDuration ? Math.round(((fullDuration - studyRemainingSeconds) / fullDuration) * 100) : 0;
  $("#session-progress-fill").style.width = `${progress}%`;
  $(".session-progress").setAttribute("aria-valuenow", String(progress));
}

function resetStudySession() {
  clearInterval(studyTimerInterval);
  studyTimerInterval = null;
  studyRemainingSeconds = Number($("#session-duration").value) * 60;
  $("#session-course").disabled = false;
  $("#session-duration").disabled = false;
  $("#toggle-session").innerHTML = '<span aria-hidden="true">▶</span> Start';
  $("#toggle-session").disabled = !$("#session-course").value;
  $("#session-status").textContent = $("#session-course").value ? "Ready when you are." : "Select a course to begin.";
  updateStudyTimer();
}

function toggleStudySession() {
  if (studyTimerInterval) {
    clearInterval(studyTimerInterval);
    studyTimerInterval = null;
    $("#session-course").disabled = false;
    $("#session-duration").disabled = false;
    $("#toggle-session").innerHTML = '<span aria-hidden="true">▶</span> Resume';
    $("#session-status").textContent = "Session paused.";
    return;
  }
  if (!$("#session-course").value) {
    showToast("Choose a course before starting a study session.");
    return;
  }
  if (studyRemainingSeconds === 0) {
    studyRemainingSeconds = Number($("#session-duration").value) * 60;
    updateStudyTimer();
  }

  $("#session-course").disabled = true;
  $("#session-duration").disabled = true;
  $("#toggle-session").innerHTML = '<span aria-hidden="true">Ⅱ</span> Pause';
  $("#session-status").textContent = `Studying ${$("#session-course").value}`;
  studyTimerInterval = setInterval(() => {
    studyRemainingSeconds -= 1;
    updateStudyTimer();
    if (studyRemainingSeconds <= 0) {
      clearInterval(studyTimerInterval);
      studyTimerInterval = null;
      $("#session-course").disabled = false;
      $("#session-duration").disabled = false;
      $("#toggle-session").innerHTML = '<span aria-hidden="true">▶</span> Start';
      $("#toggle-session").disabled = !$("#session-course").value;
      $("#session-status").textContent = "Session complete. Nice work!";
      showToast("Study session complete. Great work!");
    }
  }, 1000);
}

function openModal() {
  lastFocusedElement = document.activeElement;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  titleInput.focus();
}

function closeModal() {
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  form.reset();
  priorityInput.value = "Medium";
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
}

function openLectureModal() {
  lastFocusedElement = document.activeElement;
  lectureModal.hidden = false;
  document.body.classList.add("modal-open");
  lectureTitleInput.focus();
}

function closeLectureModal() {
  lectureModal.hidden = true;
  document.body.classList.remove("modal-open");
  lectureForm.reset();
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
}

function setSidebarOpen(isOpen) {
  document.body.classList.toggle("sidebar-open", isOpen);
  $("#menu-toggle").setAttribute("aria-expanded", String(isOpen));
  $("#menu-toggle").setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  const subject = subjectInput.value.trim();

  if (!title) {
    showToast("Please enter a task title.");
    titleInput.focus();
    return;
  }
  if (!subject) {
    showToast("Please enter a subject or course.");
    subjectInput.focus();
    return;
  }

  const taskId = window.crypto && typeof window.crypto.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  tasks.unshift({
    id: taskId,
    title,
    subject,
    priority: priorityInput.value,
    completed: false
  });
  const saved = saveTasks();
  closeModal();
  render();
  if (saved) showToast("Task added.");
});

lectureForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = lectureTitleInput.value.trim();
  const course = lectureCourseInput.value.trim();
  const date = lectureDateInput.value;

  if (!title) {
    showToast("Please enter a lecture title.");
    lectureTitleInput.focus();
    return;
  }
  if (!course) {
    showToast("Please enter a subject or course for the lecture.");
    lectureCourseInput.focus();
    return;
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    showToast("Please enter a valid lecture date.");
    lectureDateInput.focus();
    return;
  }

  lectures.push({ id: createId(), title, course, date });
  const saved = saveLectures();
  closeLectureModal();
  render();
  if (saved) showToast("Lecture added.");
});

document.querySelectorAll("[data-open-modal]").forEach((button) => button.addEventListener("click", openModal));
$("#open-lecture-modal").addEventListener("click", openLectureModal);
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    currentView = button.dataset.view;
    setSidebarOpen(false);
    render();
  });
});
$("#close-modal").addEventListener("click", closeModal);
$("#cancel-modal").addEventListener("click", closeModal);
$("#close-lecture-modal").addEventListener("click", closeLectureModal);
$("#cancel-lecture-modal").addEventListener("click", closeLectureModal);
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});
lectureModal.addEventListener("click", (event) => {
  if (event.target === lectureModal) closeLectureModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!modal.hidden) closeModal();
    if (!lectureModal.hidden) closeLectureModal();
    setSidebarOpen(false);
  }
});

taskList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const taskIndex = tasks.findIndex((task) => task.id === button.dataset.taskId);
  if (taskIndex === -1) return;

  if (button.dataset.action === "delete") {
    tasks.splice(taskIndex, 1);
    const saved = saveTasks();
    render();
    if (saved) showToast("Task deleted.");
    return;
  }

  tasks[taskIndex].completed = !tasks[taskIndex].completed;
  saveTasks();
  render();
});

$("#priority-task-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='toggle']");
  if (!button) return;
  const task = tasks.find((item) => item.id === button.dataset.taskId);
  if (!task) return;
  task.completed = !task.completed;
  saveTasks();
  render();
});

$("#lecture-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-lecture-action='delete']");
  if (!button) return;
  const lectureIndex = lectures.findIndex((lecture) => lecture.id === button.dataset.lectureId);
  if (lectureIndex === -1) return;
  lectures.splice(lectureIndex, 1);
  const saved = saveLectures();
  render();
  if (saved) showToast("Lecture deleted.");
});

$("#generate-recommendations").addEventListener("click", () => {
  const openTasks = tasks.filter((task) => !task.completed);
  if (!openTasks.length) {
    $("#recommendation-copy").textContent = tasks.length
      ? "Everything is complete. Add another task whenever you are ready for your next study goal."
      : "Add a task first, then your suggestion will be based on its priority.";
    return;
  }
  const priorityOrder = { High: 0, Medium: 1, Low: 2 };
  openTasks.sort((first, second) =>
    priorityOrder[first.priority] - priorityOrder[second.priority] ||
    first.title.localeCompare(second.title)
  );
  const nextTask = openTasks[0];
  $("#recommendation-copy").textContent = `Start with "${nextTask.title}" for ${nextTask.subject}. It is your highest-priority open task.`;
});

$("#session-course").addEventListener("change", () => {
  $("#toggle-session").disabled = !$("#session-course").value;
  $("#session-status").textContent = $("#session-course").value ? "Ready when you are." : "Select a course to begin.";
});
$("#session-duration").addEventListener("change", resetStudySession);
$("#toggle-session").addEventListener("click", toggleStudySession);
$("#reset-session").addEventListener("click", resetStudySession);

$("#menu-toggle").addEventListener("click", () => {
  setSidebarOpen(!document.body.classList.contains("sidebar-open"));
});
$("#sidebar-scrim").addEventListener("click", () => setSidebarOpen(false));
$("#today-date").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric"
});

tasks.push(...loadTasks());
lectures.push(...loadLectures());
render();

// ── Populate profile from logged-in user ──────────────────────────────────────
(function applyUserProfile() {
  let user = { name: "Student", email: "" };
  try {
    const stored = localStorage.getItem("loggedInUser");
    if (stored) user = { ...user, ...JSON.parse(stored) };
  } catch (_) {}

  const name    = user.name || "Student";
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join("");

  // Topbar button
  const avatarEl       = $(".avatar");
  const profileNameEl  = $(".profile-name");
  if (avatarEl)      avatarEl.textContent      = initials;
  if (profileNameEl) profileNameEl.textContent = name;

  // Dropdown header
  const dropAvatarEl = $(".profile-dropdown-avatar");
  const dropNameEl   = $(".profile-dropdown-name");
  if (dropAvatarEl) dropAvatarEl.textContent = initials;
  if (dropNameEl)   dropNameEl.textContent   = name;

  // "Hello, Student" greeting on dashboard
  const greetingEl = $("#study-dashboard-view .welcome-row h1");
  if (greetingEl) greetingEl.textContent = `Hello, ${name.split(" ")[0]}`;
})();

// ── Profile dropdown ──────────────────────────────────────────────────────────
const profileToggle = $("#profile-menu-toggle");
const profileDropdown = $("#profile-dropdown");

function setProfileDropdownOpen(isOpen) {
  profileDropdown.hidden = !isOpen;
  profileToggle.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    // Focus the first menu item when opening via keyboard
    const firstItem = profileDropdown.querySelector(".profile-dropdown-item");
    if (firstItem) firstItem.focus();
  }
}

profileToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  const isOpen = profileToggle.getAttribute("aria-expanded") === "true";
  setProfileDropdownOpen(!isOpen);
});

// Close when clicking outside
document.addEventListener("click", (event) => {
  if (!profileDropdown.hidden && !profileToggle.contains(event.target) && !profileDropdown.contains(event.target)) {
    setProfileDropdownOpen(false);
  }
});

// Close on Escape (add to existing keydown listener logic)
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileDropdown.hidden) {
    setProfileDropdownOpen(false);
    profileToggle.focus();
  }
});

// Keyboard navigation inside dropdown (ArrowDown / ArrowUp / Tab)
profileDropdown.addEventListener("keydown", (event) => {
  const items = [...profileDropdown.querySelectorAll(".profile-dropdown-item")];
  const index = items.indexOf(document.activeElement);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    items[(index + 1) % items.length].focus();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    items[(index - 1 + items.length) % items.length].focus();
  }
});

// ── Log Out ───────────────────────────────────────────────────────────────────
$("#logout-btn").addEventListener("click", async () => {
  setProfileDropdownOpen(false);

  // Tell the server to delete the session (clears the HttpOnly cookie)
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Length": "0" },
    });
  } catch (_) {
    // Network error — still clear client-side state
  }

  // Clear all locally stored session data
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LECTURES_STORAGE_KEY);
  localStorage.removeItem("loggedInUser");

  // Redirect to login page; ?logged_out=1 triggers the green notice on login.html
  window.location.href = "login.html?logged_out=1";
});

// ── Change Password modal ─────────────────────────────────────────────────────
const changePasswordModal = $("#change-password-modal");
const changePasswordForm = $("#change-password-form");

function openChangePasswordModal() {
  lastFocusedElement = document.activeElement;
  changePasswordModal.hidden = false;
  document.body.classList.add("modal-open");
  $("#current-password").focus();
}

function closeChangePasswordModal() {
  changePasswordModal.hidden = true;
  document.body.classList.remove("modal-open");
  changePasswordForm.reset();
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
}

$("#change-password-btn").addEventListener("click", () => {
  setProfileDropdownOpen(false);
  openChangePasswordModal();
});

$("#close-change-password-modal").addEventListener("click", closeChangePasswordModal);
$("#cancel-change-password-modal").addEventListener("click", closeChangePasswordModal);

changePasswordModal.addEventListener("click", (event) => {
  if (event.target === changePasswordModal) closeChangePasswordModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !changePasswordModal.hidden) closeChangePasswordModal();
});

changePasswordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const currentPassword = $("#current-password").value;
  const newPassword = $("#new-password").value;
  const confirmPassword = $("#confirm-password").value;

  if (!currentPassword) {
    showToast("Please enter your current password.");
    $("#current-password").focus();
    return;
  }
  if (newPassword.length < 8) {
    showToast("New password must be at least 8 characters.");
    $("#new-password").focus();
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast("Passwords do not match. Please try again.");
    $("#confirm-password").focus();
    return;
  }

  // TODO: wire this to your auth provider (e.g. supabase.auth.updateUser)
  // For now we show a success message as a placeholder.
  closeChangePasswordModal();
  showToast("Password updated successfully.");
});

// ══════════════════════════════════════════════════════════════════════════════
// STUDENTS VIEW
// ══════════════════════════════════════════════════════════════════════════════

let allStudents = [];          // full list fetched from server
let studentsLoaded = false;    // avoid repeat fetches

function escHtml(v) { return escapeHtml(v ?? ""); }

async function loadStudentsView() {
  // Re-render the filtered table on every switch but only fetch once per session
  if (!studentsLoaded) {
    $("#students-tbody").innerHTML = `<tr class="portal-loading-row"><td colspan="8">Loading…</td></tr>`;
    try {
      const res = await fetch("/api/students", { credentials: "same-origin" });
      if (res.status === 401) { window.location.replace("login.html"); return; }
      allStudents = await res.json();
      studentsLoaded = true;
    } catch (_) {
      $("#students-tbody").innerHTML = `<tr class="portal-empty-row"><td colspan="8">Could not load students. Is the server running?</td></tr>`;
      return;
    }
  }
  renderStudentsTable($("#student-search").value.trim());
}

function renderStudentsTable(query) {
  const q = query.toLowerCase();
  const filtered = q
    ? allStudents.filter(s =>
        (s.name  || "").toLowerCase().includes(q) ||
        (s.id    || "").toLowerCase().includes(q) ||
        (s.course|| "").toLowerCase().includes(q))
    : allStudents;

  $("#student-count").textContent = `${filtered.length} student${filtered.length !== 1 ? "s" : ""}`;

  if (!filtered.length) {
    $("#students-tbody").innerHTML = `<tr class="portal-empty-row"><td colspan="8">${q ? "No students match your search." : "No students yet. Add one to get started."}</td></tr>`;
    return;
  }

  $("#students-tbody").innerHTML = filtered.map(s => `
    <tr data-student-id="${escHtml(s.id)}">
      <td><span class="student-id-badge">${escHtml(s.id)}</span></td>
      <td style="font-weight:600">${escHtml(s.name)}</td>
      <td>${escHtml(s.course)}</td>
      <td>${s.level ? `Level ${escHtml(s.level)}` : "—"}</td>
      <td>${escHtml(s.gender) || "—"}</td>
      <td>${s.email ? `<a href="mailto:${escHtml(s.email)}" style="color:var(--blue)">${escHtml(s.email)}</a>` : "—"}</td>
      <td>${escHtml(s.phone) || "—"}</td>
      <td>
        <button class="row-delete-btn" type="button"
          data-action="delete-student" data-student-id="${escHtml(s.id)}"
          aria-label="Delete student ${escHtml(s.name)}" title="Delete student">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4h4v2m3 0-.7 10H5.7L5 6m3 3v4m4-4v4"/></svg>
        </button>
      </td>
    </tr>
  `).join("");
}

// Live search
$("#student-search").addEventListener("input", () => {
  renderStudentsTable($("#student-search").value.trim());
});

// Delete student via row button (event delegation on table body)
$("#students-tbody").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action='delete-student']");
  if (!btn) return;
  const sid  = btn.dataset.studentId;
  const name = btn.closest("tr")?.querySelector("td:nth-child(2)")?.textContent || sid;
  if (!confirm(`Delete "${name}" and all their attendance records? This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/students/${encodeURIComponent(sid)}`, {
      method: "DELETE", credentials: "same-origin"
    });
    if (res.status === 401) { window.location.replace("login.html"); return; }
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    allStudents = allStudents.filter(s => s.id !== sid);
    renderStudentsTable($("#student-search").value.trim());
    showToast(`${name} removed.`);
  } catch (err) {
    showToast(err.message || "Could not delete student.");
  }
});

// ── Add Student modal ──────────────────────────────────────────────────────────
const addStudentModal = $("#add-student-modal");
const addStudentForm  = $("#add-student-form");

function openAddStudentModal() {
  lastFocusedElement = document.activeElement;
  addStudentModal.hidden = false;
  document.body.classList.add("modal-open");
  $("#as-name").focus();
}
function closeAddStudentModal() {
  addStudentModal.hidden = true;
  document.body.classList.remove("modal-open");
  addStudentForm.reset();
  if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
}

$("#open-add-student-modal").addEventListener("click",  openAddStudentModal);
$("#close-add-student-modal").addEventListener("click", closeAddStudentModal);
$("#cancel-add-student-modal").addEventListener("click",closeAddStudentModal);
addStudentModal.addEventListener("click", e => { if (e.target === addStudentModal) closeAddStudentModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !addStudentModal.hidden) closeAddStudentModal(); });

addStudentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    id:     $("#as-id").value.trim(),
    name:   $("#as-name").value.trim(),
    course: $("#as-course").value.trim(),
    level:  $("#as-level").value,
    gender: $("#as-gender").value || null,
    email:  $("#as-email").value.trim() || null,
    phone:  $("#as-phone").value.trim() || null,
  };
  if (!payload.id || !payload.name || !payload.course) {
    showToast("Name, ID and Course are required.");
    return;
  }
  try {
    const res = await fetch("/api/students", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { window.location.replace("login.html"); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    allStudents.push({ ...payload, gender: payload.gender || "", email: payload.email || "", phone: payload.phone || "" });
    allStudents.sort((a, b) => a.name.localeCompare(b.name));
    closeAddStudentModal();
    renderStudentsTable($("#student-search").value.trim());
    showToast("Student added.");
  } catch (err) {
    showToast(err.message || "Could not save student.");
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// ATTENDANCE VIEW
// ══════════════════════════════════════════════════════════════════════════════

let attStudents  = [];   // student list for attendance (fetched once)
let attRecords   = {};   // { student_id: "Present"|"Absent"|"Late"|"" }
let attFilter    = "all";
let attDateValue = "";

// Set default date to today
const todayISO = new Date().toISOString().slice(0, 10);
$("#att-date").value = todayISO;
attDateValue = todayISO;

async function loadAttendanceView() {
  // Fetch student list once
  if (!attStudents.length) {
    try {
      const res = await fetch("/api/students", { credentials: "same-origin" });
      if (res.status === 401) { window.location.replace("login.html"); return; }
      attStudents = await res.json();
    } catch (_) {
      $("#attendance-tbody").innerHTML = `<tr class="portal-empty-row"><td colspan="5">Could not load students.</td></tr>`;
      return;
    }
  }
  await fetchAttendanceForDate(attDateValue);
}

async function fetchAttendanceForDate(dateStr) {
  if (!dateStr) return;
  $("#attendance-tbody").innerHTML = `<tr class="portal-loading-row"><td colspan="5">Loading…</td></tr>`;
  attRecords = {};

  try {
    const res = await fetch(`/api/attendance?date=${encodeURIComponent(dateStr)}`, { credentials: "same-origin" });
    if (res.status === 401) { window.location.replace("login.html"); return; }
    const records = await res.json();
    records.forEach(r => { attRecords[r.student_id.toUpperCase()] = r.status; });
  } catch (_) {
    $("#attendance-tbody").innerHTML = `<tr class="portal-empty-row"><td colspan="5">Could not load attendance.</td></tr>`;
    return;
  }

  renderAttendanceTable();
  updateAttSaveBar();
}

function renderAttendanceTable() {
  let rows = attStudents.map(s => ({
    ...s,
    status: attRecords[s.id.toUpperCase()] || ""
  }));

  if (attFilter !== "all") {
    rows = rows.filter(s => attFilter === "Unmarked" ? !s.status : s.status === attFilter);
  }

  const total     = attStudents.length;
  const marked    = Object.keys(attRecords).length;
  const present   = Object.values(attRecords).filter(v => v === "Present").length;
  const absent    = Object.values(attRecords).filter(v => v === "Absent").length;
  const late      = Object.values(attRecords).filter(v => v === "Late").length;
  const unmarked  = total - marked;

  const filterCounts = { all: total, Present: present, Absent: absent, Late: late };
  document.querySelectorAll(".att-filter-btn").forEach(btn => {
    const f = btn.dataset.filter;
    const count = filterCounts[f] ?? unmarked;
    btn.textContent = f === "all" ? `All (${total})` : `${f} (${count})`;
    btn.classList.toggle("active", f === attFilter);
  });

  const shown = rows.length;
  $("#att-count").textContent = `${shown} student${shown !== 1 ? "s" : ""}`;

  if (!rows.length) {
    $("#attendance-tbody").innerHTML = `<tr class="portal-empty-row"><td colspan="5">No students match this filter.</td></tr>`;
    return;
  }

  $("#attendance-tbody").innerHTML = rows.map(s => {
    const status = s.status;
    const selClass = status === "Present" ? "is-present" : status === "Absent" ? "is-absent" : status === "Late" ? "is-late" : "";
    const badgeClass = status ? status.toLowerCase() : "unmarked";
    return `
      <tr data-sid="${escHtml(s.id)}">
        <td><span class="student-id-badge">${escHtml(s.id)}</span></td>
        <td style="font-weight:600">${escHtml(s.name)}</td>
        <td>${escHtml(s.course)}</td>
        <td>${s.level ? `Level ${escHtml(s.level)}` : "—"}</td>
        <td>
          <select class="att-status-select ${selClass}" data-sid="${escHtml(s.id)}" aria-label="Status for ${escHtml(s.name)}">
            <option value="" ${!status ? "selected" : ""}>— Mark —</option>
            <option value="Present" ${status === "Present" ? "selected" : ""}>Present</option>
            <option value="Absent"  ${status === "Absent"  ? "selected" : ""}>Absent</option>
            <option value="Late"    ${status === "Late"    ? "selected" : ""}>Late</option>
          </select>
        </td>
      </tr>
    `;
  }).join("");
}

// Update status inline when a select changes
$("#attendance-tbody").addEventListener("change", (e) => {
  const sel = e.target.closest(".att-status-select");
  if (!sel) return;
  const sid    = sel.dataset.sid.toUpperCase();
  const status = sel.value;
  if (status) {
    attRecords[sid] = status;
  } else {
    delete attRecords[sid];
  }
  // Update visual class on the select
  sel.className = "att-status-select" + (status === "Present" ? " is-present" : status === "Absent" ? " is-absent" : status === "Late" ? " is-late" : "");
  updateAttSaveBar();
});

function updateAttSaveBar() {
  const total   = attStudents.length;
  const marked  = Object.keys(attRecords).length;
  const bar     = $("#att-save-bar");
  bar.hidden    = total === 0;
  const present = Object.values(attRecords).filter(v => v === "Present").length;
  const absent  = Object.values(attRecords).filter(v => v === "Absent").length;
  const late    = Object.values(attRecords).filter(v => v === "Late").length;
  $("#att-save-info").textContent =
    `${marked}/${total} marked — Present: ${present}  Absent: ${absent}  Late: ${late}`;
}

// Filter buttons
document.querySelectorAll(".att-filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    attFilter = btn.dataset.filter;
    renderAttendanceTable();
  });
});

// Date change
$("#att-date").addEventListener("change", () => {
  attDateValue = $("#att-date").value;
  if (currentView === "attendance") fetchAttendanceForDate(attDateValue);
});

// Mark all shortcut buttons — dynamically mark all visible students
document.querySelector("#attendance-view").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-mark-all]");
  if (!btn) return;
  const status = btn.dataset.markAll;
  attStudents.forEach(s => { if (status) attRecords[s.id.toUpperCase()] = status; else delete attRecords[s.id.toUpperCase()]; });
  renderAttendanceTable();
  updateAttSaveBar();
});

// Save attendance
$("#save-attendance-btn").addEventListener("click", async () => {
  const dateStr = attDateValue;
  if (!dateStr) { showToast("Select a date first."); return; }

  const records = Object.entries(attRecords).map(([student_id, status]) => ({ student_id, status }));
  if (!records.length) { showToast("Mark at least one student before saving."); return; }

  const btn = $("#save-attendance-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    const res = await fetch("/api/attendance", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: dateStr, records }),
    });
    if (res.status === 401) { window.location.replace("login.html"); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`Attendance saved for ${dateStr} (${data.count} record${data.count !== 1 ? "s" : ""}).`);
  } catch (err) {
    showToast(err.message || "Could not save attendance.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Attendance";
  }
});
