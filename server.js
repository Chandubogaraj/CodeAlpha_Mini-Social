// ============================================================
// MINI SOCIAL MEDIA PLATFORM - SERVER
// Backend: Node.js + Express + SQLite (better-sqlite3)
// ============================================================

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// DATABASE SETUP (Node's built-in SQLite — no native compile needed)
// ------------------------------------------------------------
const dbPath = path.join(__dirname, 'db', 'social.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

// Initialize schema from schema.sql
const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
db.exec(schema);

// ------------------------------------------------------------
// MIDDLEWARE
// ------------------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'mini-social-secret-key-codealpha',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 days
}));

// Auth guard middleware - protects routes that require login
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not authenticated. Please log in.' });
    }
    next();
}

// Helper: shape a user row into a public-facing profile object
function publicUser(userRow, viewerId = null) {
    if (!userRow) return null;
    const followerCount = db.prepare('SELECT COUNT(*) AS c FROM follows WHERE following_id = ?').get(userRow.id).c;
    const followingCount = db.prepare('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?').get(userRow.id).c;
    const postCount = db.prepare('SELECT COUNT(*) AS c FROM posts WHERE author_id = ?').get(userRow.id).c;
    let isFollowing = false;
    if (viewerId) {
        isFollowing = !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(viewerId, userRow.id);
    }
    return {
        id: userRow.id,
        username: userRow.username,
        email: userRow.email,
        bio: userRow.bio,
        avatarColor: userRow.avatar_color,
        createdAt: userRow.created_at,
        followerCount,
        followingCount,
        postCount,
        isFollowing
    };
}

// Helper: shape a post row with author info, like count, comment count
function publicPost(postRow, viewerId = null) {
    const author = db.prepare('SELECT id, username, avatar_color FROM users WHERE id = ?').get(postRow.author_id);
    const likeCount = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?').get(postRow.id).c;
    const commentCount = db.prepare('SELECT COUNT(*) AS c FROM comments WHERE post_id = ?').get(postRow.id).c;
    let likedByMe = false;
    if (viewerId) {
        likedByMe = !!db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(postRow.id, viewerId);
    }
    return {
        id: postRow.id,
        content: postRow.content,
        createdAt: postRow.created_at,
        author: {
            id: author.id,
            username: author.username,
            avatarColor: author.avatar_color
        },
        likeCount,
        commentCount,
        likedByMe
    };
}

// ============================================================
// AUTH ROUTES
// ============================================================

// POST /api/register  -> create a new user profile
app.post('/api/register', (req, res) => {
    const { username, email, password, bio } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existing) {
        return res.status(409).json({ error: 'Username or email already in use.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    // Assign a random pleasant avatar color
    const colors = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const result = db.prepare(
        'INSERT INTO users (username, email, password_hash, bio, avatar_color) VALUES (?, ?, ?, ?, ?)'
    ).run(username, email, hash, bio || '', color);

    req.session.userId = result.lastInsertRowid;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.json({ user: publicUser(user, result.lastInsertRowid) });
});

// POST /api/login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid username or password.' });
    }
    req.session.userId = user.id;
    res.json({ user: publicUser(user, user.id) });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

// GET /api/me -> current logged in user
app.get('/api/me', (req, res) => {
    if (!req.session.userId) return res.json({ user: null });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return res.json({ user: null });
    res.json({ user: publicUser(user, user.id) });
});

// ============================================================
// USER PROFILE ROUTES
// ============================================================

// GET /api/users/:id -> view a profile (any user)
app.get('/api/users/:id', (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: publicUser(user, req.session.userId || null) });
});

// PUT /api/users/:id -> update own profile (bio)
app.put('/api/users/:id', requireAuth, (req, res) => {
    if (parseInt(req.params.id) !== req.session.userId) {
        return res.status(403).json({ error: 'You can only edit your own profile.' });
    }
    const { bio } = req.body;
    db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio || '', req.session.userId);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    res.json({ user: publicUser(user, user.id) });
});

// GET /api/users/:id/posts -> all posts by a specific user
app.get('/api/users/:id/posts', (req, res) => {
    const rows = db.prepare('SELECT * FROM posts WHERE author_id = ? ORDER BY created_at DESC').all(req.params.id);
    res.json({ posts: rows.map(r => publicPost(r, req.session.userId || null)) });
});

// GET /api/users -> search/list users (for follow suggestions)
app.get('/api/users', (req, res) => {
    const q = req.query.q || '';
    const rows = db.prepare('SELECT * FROM users WHERE username LIKE ? LIMIT 20').all(`%${q}%`);
    res.json({ users: rows.map(r => publicUser(r, req.session.userId || null)) });
});

// ============================================================
// FOLLOW SYSTEM ROUTES
// ============================================================

// POST /api/users/:id/follow -> toggle follow/unfollow
app.post('/api/users/:id/follow', requireAuth, (req, res) => {
    const targetId = parseInt(req.params.id);
    const myId = req.session.userId;
    if (targetId === myId) {
        return res.status(400).json({ error: "You can't follow yourself." });
    }
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const existing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(myId, targetId);
    if (existing) {
        db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(myId, targetId);
        return res.json({ following: false });
    } else {
        db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(myId, targetId);
        return res.json({ following: true });
    }
});

// GET /api/users/:id/followers -> list of followers
app.get('/api/users/:id/followers', (req, res) => {
    const rows = db.prepare(`
        SELECT u.* FROM users u
        JOIN follows f ON f.follower_id = u.id
        WHERE f.following_id = ?
        ORDER BY f.created_at DESC
    `).all(req.params.id);
    res.json({ users: rows.map(r => publicUser(r, req.session.userId || null)) });
});

// GET /api/users/:id/following -> list of users this person follows
app.get('/api/users/:id/following', (req, res) => {
    const rows = db.prepare(`
        SELECT u.* FROM users u
        JOIN follows f ON f.following_id = u.id
        WHERE f.follower_id = ?
        ORDER BY f.created_at DESC
    `).all(req.params.id);
    res.json({ users: rows.map(r => publicUser(r, req.session.userId || null)) });
});

// ============================================================
// POSTS ROUTES
// ============================================================

// GET /api/posts -> main feed (all posts, newest first)
app.get('/api/posts', (req, res) => {
    const rows = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 100').all();
    res.json({ posts: rows.map(r => publicPost(r, req.session.userId || null)) });
});

// GET /api/feed -> posts from people the current user follows (+ own posts)
app.get('/api/feed', requireAuth, (req, res) => {
    const myId = req.session.userId;
    const rows = db.prepare(`
        SELECT p.* FROM posts p
        WHERE p.author_id = ?
           OR p.author_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
        ORDER BY p.created_at DESC LIMIT 100
    `).all(myId, myId);
    res.json({ posts: rows.map(r => publicPost(r, myId)) });
});

// POST /api/posts -> create a new post
app.post('/api/posts', requireAuth, (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'Post content cannot be empty.' });
    }
    const result = db.prepare('INSERT INTO posts (author_id, content) VALUES (?, ?)').run(req.session.userId, content.trim());
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ post: publicPost(post, req.session.userId) });
});

// DELETE /api/posts/:id -> delete own post
app.delete('/api/posts/:id', requireAuth, (req, res) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    if (post.author_id !== req.session.userId) {
        return res.status(403).json({ error: 'You can only delete your own posts.' });
    }
    db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

// ============================================================
// LIKES ROUTES
// ============================================================

// POST /api/posts/:id/like -> toggle like/unlike
app.post('/api/posts/:id/like', requireAuth, (req, res) => {
    const postId = req.params.id;
    const myId = req.session.userId;
    const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const existing = db.prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?').get(postId, myId);
    if (existing) {
        db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(postId, myId);
    } else {
        db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(postId, myId);
    }
    const likeCount = db.prepare('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?').get(postId).c;
    res.json({ liked: !existing, likeCount });
});

// ============================================================
// COMMENTS ROUTES
// ============================================================

// GET /api/posts/:id/comments -> all comments on a post
app.get('/api/posts/:id/comments', (req, res) => {
    const rows = db.prepare(`
        SELECT c.*, u.username, u.avatar_color
        FROM comments c
        JOIN users u ON u.id = c.author_id
        WHERE c.post_id = ?
        ORDER BY c.created_at ASC
    `).all(req.params.id);
    res.json({
        comments: rows.map(r => ({
            id: r.id,
            content: r.content,
            createdAt: r.created_at,
            author: { id: r.author_id, username: r.username, avatarColor: r.avatar_color }
        }))
    });
});

// POST /api/posts/:id/comments -> add a comment
app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim()) {
        return res.status(400).json({ error: 'Comment cannot be empty.' });
    }
    const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found.' });

    const result = db.prepare('INSERT INTO comments (post_id, author_id, content) VALUES (?, ?, ?)')
        .run(req.params.id, req.session.userId, content.trim());

    const c = db.prepare(`
        SELECT c.*, u.username, u.avatar_color FROM comments c
        JOIN users u ON u.id = c.author_id WHERE c.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({
        comment: {
            id: c.id,
            content: c.content,
            createdAt: c.created_at,
            author: { id: c.author_id, username: c.username, avatarColor: c.avatar_color }
        }
    });
});

// DELETE /api/comments/:id -> delete own comment
app.delete('/api/comments/:id', requireAuth, (req, res) => {
    const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });
    if (comment.author_id !== req.session.userId) {
        return res.status(403).json({ error: 'You can only delete your own comments.' });
    }
    db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

// ------------------------------------------------------------
// Fallback to index.html for SPA routing
// ------------------------------------------------------------
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`✅ Mini Social Media server running at http://localhost:${PORT}`);
    console.log(`📦 Database file: ${dbPath}`);
});
