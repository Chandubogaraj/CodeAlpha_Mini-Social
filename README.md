# MiniSocial — Mini Social Media Platform
**CodeAlpha Internship — Task 2 (Full Stack Development)**

A complete mini social media app: user profiles, posts & comments, and a like/follow system, built with HTML/CSS/JS on the frontend and Express.js + SQLite on the backend, exactly as specified in the task brief.

---

## 1. Tech Stack

| Layer    | Technology |
|----------|------------|
| Frontend | HTML, CSS, vanilla JavaScript (single-page app, no build step) |
| Backend  | Node.js + Express.js |
| Database | SQLite (Node's built-in `node:sqlite` — no native compilation needed) |
| Auth     | express-session (cookie sessions) + bcryptjs (password hashing) |

---

## 2. How to Run It

```bash
cd mini-social
npm install
npm start
```

Then open **http://localhost:3000** in your browser. The SQLite database file is created automatically at `db/social.db` on first run (schema in `db/schema.sql`).

---

## 3. Project Structure

```
mini-social/
├── server.js          # Express app + all API routes
├── package.json
├── db/
│   └── schema.sql      # Table definitions (users, posts, comments, likes, follows)
└── public/             # Frontend (served statically by Express)
    ├── index.html       # Page structure (auth screen, feed, profile, modals)
    ├── style.css         # Styling
    └── app.js            # All frontend logic — talks to the API via fetch()
```

---

## 4. How Frontend & Backend Are Connected

This is the key part of the architecture — here's exactly how a click in the browser turns into a database change and back again.

### 4.1 The request/response cycle
1. **Browser (app.js)** calls a small helper function `api(path, options)`, which wraps `fetch('/api' + path, ...)`. It always sends `credentials: 'same-origin'` so the session cookie is included.
2. **Express server (server.js)** receives the request. `express.json()` middleware parses the JSON body into `req.body`.
3. **express-session** middleware reads the signed cookie and attaches `req.session`, which holds `req.session.userId` for logged-in users.
4. The matching **route handler** runs a SQL query against the SQLite database using `db.prepare(sql).get/all/run(...)`.
5. The handler shapes the raw database row into a clean JSON object (via the `publicUser()` / `publicPost()` helper functions) and calls `res.json({...})`.
6. **app.js** receives the JSON, and re-renders the relevant part of the page (no full page reload — it's a single-page app).

### 4.2 Authentication flow
- `POST /api/register` → hashes the password with bcrypt, inserts a row into `users`, and stores `userId` in the session.
- `POST /api/login` → looks up the user by username/email, compares the password hash, and stores `userId` in the session on success.
- `GET /api/me` → on page load, app.js calls this to check "am I already logged in?" (the cookie persists across reloads).
- `requireAuth` middleware → any route that needs a logged-in user (creating posts, liking, commenting, following) checks `req.session.userId` first and returns `401` if missing.

### 4.3 Database relationships
```
users ──┬──< posts (author_id)
        ├──< comments (author_id)
        ├──< likes (user_id)        likes ──> posts (post_id)
        └──< follows (follower_id)  follows ──> users (following_id)
```
- **Posts & Comments**: each row stores the `author_id` (foreign key → `users.id`), so every post/comment is linked to a profile.
- **Likes**: a join table between `users` and `posts` with a `UNIQUE(post_id, user_id)` constraint — this is what makes "like" a toggle (one like per user per post).
- **Follows**: a self-referencing join table on `users` (`follower_id` → `following_id`) — this powers both the follow/unfollow button and the "Following" feed filter.

### 4.4 Feature → Route → Table map

| Feature (from brief)     | Frontend action                  | API route                          | Table(s) touched         |
|---------------------------|-----------------------------------|--------------------------------------|----------------------------|
| User profiles              | View/edit profile page            | `GET/PUT /api/users/:id`             | `users`                     |
| Posts                       | Composer "Post" button             | `POST /api/posts`                    | `posts`                     |
| Comments                    | Comment box in post modal          | `POST /api/posts/:id/comments`       | `comments`                  |
| Like system                 | ❤️ button on each post             | `POST /api/posts/:id/like`           | `likes`                     |
| Follow system               | "Follow" button on profile         | `POST /api/users/:id/follow`         | `follows`                   |
| Feed (following)            | "Following" tab                    | `GET /api/feed`                      | `posts` + `follows` (JOIN)  |
| Global feed (Explore)       | "Explore" tab                      | `GET /api/posts`                     | `posts`                     |
| Followers/Following lists   | Tapping stats on profile           | `GET /api/users/:id/followers|following` | `follows` + `users`     |

### 4.5 Frontend rendering
- `app.js` keeps a small amount of state (`currentUser`, `currentProfileId`, `activeModalPostId`) and re-renders DOM fragments by setting `innerHTML` from template strings (`postHtml()`, comment rows, follow-list rows).
- Every dynamic value (usernames, post content, bios) is passed through `escapeHtml()` before being inserted, to prevent any HTML/script injection from user-generated content.
- Modals (post detail + comments, followers/following list) are plain `<div>` overlays toggled with a `hidden` class — no extra libraries needed.

---

## 5. Notes / Possible Extensions
- Image uploads for posts/avatars aren't included (the brief listed text-based features only) but could be added with `multer` + an `/uploads` static folder.
- The database file `db/social.db` is created fresh — delete it to reset all data.
