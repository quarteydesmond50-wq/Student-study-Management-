# Student Study Planner Web Application

## Project overview

The Jbrains.Tech Student Study Planner helps students keep a simple list of assignments and study tasks. Each task has a title and subject or course name. The app uses HTML, CSS, and JavaScript, and stores tasks in the current browser.

## Requirements and features

- Add a task with a title and subject or course.
- Display saved tasks in a clear list.
- Mark tasks complete and change them back to incomplete.
- Delete tasks.
- Keep tasks after a page refresh using browser local storage.
- Show a helpful empty-list message and reject blank titles.
- Optional priority label as the one extra feature.
- Study Overview page with prioritized tasks, course completion, recommendations, and a focus timer.
- Add lectures with a title, subject/course, and optional date; lecture records remain in browser local storage.
- Insights page with task completion, course progress, and priority breakdowns.
- Responsive layout for laptop, tablet, and smartphone screens.

The project does not require user accounts, an online database, payments, or external APIs.

## Testing checklist

| Test | Result |
| --- | --- |
| Open the app with no saved tasks | Empty-list message and Add Task button are shown. |
| Submit a blank or whitespace-only task title | Task is rejected with a helpful message. |
| Submit a blank or whitespace-only subject | Task is rejected with a helpful message. |
| Add a task with a title, subject, and priority | Task appears in the list. |
| Mark a task complete and incomplete | Task status changes and can be reversed. |
| Delete a task | Task is removed from the list. |
| Refresh the page | Tasks remain in the same browser. |
| Open the app at different screen widths | Layout adapts to phone, tablet, and laptop widths. |
| Use Study Overview and Insights | Both pages reflect current tasks and course progress. |
| Add and delete lectures | Lectures appear in the Study Overview and remain after refresh. |

Tasks and lectures are stored separately in each browser and do not synchronize across devices.

## Running on other devices

Run `python server.py` on the laptop, then use the laptop's Wi-Fi IPv4 address and port `8000` in a browser on another device connected to the same trusted Wi-Fi. See [README.md](./README.md) for steps.

## Assistance and academic integrity

AI assistance was used to help implement the HTML, CSS, and JavaScript. I will review and understand the source code so I can explain how the application works.
