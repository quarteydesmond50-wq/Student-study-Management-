# Jbrains.Tech Student Study Planner

A responsive study-task list for organizing assignments by subject or course. Tasks are stored in the browser's local storage.

## Features

- Add a task with a title and subject or course.
- View saved tasks in a clear list.
- Mark a task complete and change it back to incomplete.
- Delete tasks.
- Keep tasks after refreshing the page in the same browser.
- Show an empty-list message and reject blank task titles or subjects.
- Optional priority label (the single extra feature).
- Study Overview page with prioritized tasks, course completion, recommendations, and a focus timer.
- Add lectures with a title, subject/course, and optional date; saved lectures appear in the Study Overview.
- Insights page with task completion, course progress, and open-task priority breakdowns.
- Responsive layout for laptops, tablets, and smartphones.

## Run on your laptop

From the project folder, start the app server:

```bash
python server.py
```

Open `http://localhost:8000` on the laptop.

## Open on a phone or another device on the same Wi-Fi

1. Keep `python server.py` running on the laptop.
2. On Windows, run `ipconfig` and find the **IPv4 Address** under the active Wi-Fi adapter.
3. On the other device, visit `http://<laptop-ip>:8000`, replacing `<laptop-ip>` with that address (for example, `http://192.168.1.25:8000`).
4. If Windows Firewall prompts you, allow Python on your **private network**.

The laptop and other device must be on the same trusted Wi-Fi network. The server does not provide sign-in or encryption, so do not expose it to the public internet or use it for sensitive information. Tasks and lectures are stored separately in each device's browser and do not sync between devices.

## Files

- `index.html` – task list, Study Overview, Insights, and add-task form
- `style.css` – responsive page layouts and styling
- `script.js` – navigation, task actions, overview, insights, timer, and browser local storage
- `server.py` – local web server
- `jbrains-tech-logo.jpeg` – Jbrains.Tech logo
