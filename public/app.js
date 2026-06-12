// ============================================================
// MINISOCIAL — FRONTEND LOGIC
// All data flows through fetch() calls to the Express API
// defined in server.js. No page reloads — single page app.
// ============================================================

let currentUser = null;       // logged-in user object
let activeModalPostId = null; // post currently open in modal
let currentProfileId = null;  // profile currently being viewed
let currentFeedMode = 'following';

// ------------------------------------------------------------
// API HELPER — wraps fetch, sends cookies, parses JSON
// ------------------------------------------------------------
async function api(path, options = {}) {
    const res = await fetch('/api' + path, {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
}

// ------------------------------------------------------------
// INITIAL LOAD — check if a session already exists
// ------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const { user } = await api('/me');
        if (user) {
            currentUser = user;
            enterApp();
        }
    } catch (e) { /* not logged in, show auth screen */ }

    // wire up forms
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    document.getElementById('postContent').addEventListener('input', e => {
        document.getElementById('charCount').textContent = `${e.target.value.length}/500`;
    });
    document.getElementById('commentInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') submitComment();
    });
});

// ============================================================
// AUTH
// ============================================================
function switchTab(tab) {
    document.getElementById('loginTab').classList.toggle('active', tab === 'login');
    document.getElementById('registerTab').classList.toggle('active', tab === 'register');
    document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
    document.getElementById('authError').textContent = '';
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    try {
        const { user } = await api('/login', { method: 'POST', body: JSON.stringify({ username, password }) });
        currentUser = user;
        enterApp();
    } catch (err) {
        document.getElementById('authError').textContent = err.message;
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const bio = document.getElementById('regBio').value.trim();
    try {
        const { user } = await api('/register', { method: 'POST', body: JSON.stringify({ username, email, password, bio }) });
        currentUser = user;
        enterApp();
    } catch (err) {
        document.getElementById('authError').textContent = err.message;
    }
}

async function logout() {
    await api('/logout', { method: 'POST' });
    currentUser = null;
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('hidden');
    document.getElementById('navLinks').classList.add('hidden');
    document.getElementById('loginForm').reset();
}

function enterApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('navLinks').classList.remove('hidden');
    navigateTo('feed');
}

// ============================================================
// NAVIGATION
// ============================================================
function navigateTo(view, profileId = null) {
    document.getElementById('feedView').classList.toggle('hidden', view !== 'feed' && view !== 'global');
    document.getElementById('profileView').classList.toggle('hidden', view !== 'profile');

    if (view === 'feed') {
        currentFeedMode = 'following';
        document.getElementById('followingTab').classList.add('active');
        document.getElementById('globalTab').classList.remove('active');
        loadFeed('following');
    } else if (view === 'global') {
        currentFeedMode = 'global';
        document.getElementById('followingTab').classList.remove('active');
        document.getElementById('globalTab').classList.add('active');
        loadFeed('global');
    } else if (view === 'profile') {
        loadProfile(profileId);
    }
}

// ============================================================
// FEED
// ============================================================
function loadFeed(mode) {
    currentFeedMode = mode;
    document.getElementById('followingTab').classList.toggle('active', mode === 'following');
    document.getElementById('globalTab').classList.toggle('active', mode === 'global');
    document.getElementById('feedView').classList.remove('hidden');
    document.getElementById('profileView').classList.add('hidden');

    const endpoint = mode === 'following' ? '/feed' : '/posts';
    api(endpoint).then(({ posts }) => {
        renderPosts(posts, document.getElementById('postsContainer'), mode === 'following'
            ? `<div class="empty-state"><span class="emoji">🪴</span>Your feed is empty.<br>Follow people or check Explore to see global posts.</div>`
            : `<div class="empty-state"><span class="emoji">🪴</span>No posts yet. Be the first to share something!</div>`);
    }).catch(err => console.error(err));
}

function renderPosts(posts, container, emptyHtml) {
    if (!posts.length) {
        container.innerHTML = emptyHtml;
        return;
    }
    container.innerHTML = posts.map(postHtml).join('');
}

function postHtml(post) {
    const initial = post.author.username.charAt(0).toUpperCase();
    const isMine = currentUser && post.author.id === currentUser.id;
    return `
        <div class="card post" data-post-id="${post.id}">
            <div class="post-avatar" style="background:${post.author.avatarColor}" onclick="navigateTo('profile', ${post.author.id})">${initial}</div>
            <div class="post-head">
                <span class="post-author" onclick="navigateTo('profile', ${post.author.id})">${escapeHtml(post.author.username)}</span>
                <span class="post-time">· ${timeAgo(post.createdAt)}</span>
            </div>
            <div class="post-content" onclick="openPost(${post.id})">${escapeHtml(post.content)}</div>
            <div class="post-actions">
                <button class="action-btn ${post.likedByMe ? 'liked' : ''}" onclick="toggleLike(${post.id}, this)">
                    ${post.likedByMe ? '❤️' : '🤍'} <span class="like-count">${post.likeCount}</span>
                </button>
                <button class="action-btn" onclick="openPost(${post.id})">💬 <span>${post.commentCount}</span></button>
                ${isMine ? `<button class="action-btn delete-btn" onclick="deletePost(${post.id})">🗑️</button>` : ''}
            </div>
        </div>
    `;
}

// ============================================================
// CREATE POST
// ============================================================
async function createPost() {
    const textarea = document.getElementById('postContent');
    const content = textarea.value.trim();
    if (!content) return;
    try {
        await api('/posts', { method: 'POST', body: JSON.stringify({ content }) });
        textarea.value = '';
        document.getElementById('charCount').textContent = '0/500';
        loadFeed(currentFeedMode);
    } catch (err) {
        alert(err.message);
    }
}

async function deletePost(id) {
    if (!confirm('Delete this post?')) return;
    try {
        await api(`/posts/${id}`, { method: 'DELETE' });
        // refresh whichever view is active
        if (!document.getElementById('feedView').classList.contains('hidden')) {
            loadFeed(currentFeedMode);
        } else {
            loadProfile(currentProfileId);
        }
    } catch (err) {
        alert(err.message);
    }
}

// ============================================================
// LIKES
// ============================================================
async function toggleLike(postId, btn) {
    try {
        const { liked, likeCount } = await api(`/posts/${postId}/like`, { method: 'POST' });
        btn.classList.toggle('liked', liked);
        btn.querySelector('.like-count').textContent = likeCount;
        btn.innerHTML = `${liked ? '❤️' : '🤍'} <span class="like-count">${likeCount}</span>`;
        if (liked) btn.classList.add('liked'); else btn.classList.remove('liked');
    } catch (err) {
        alert(err.message);
    }
}

// ============================================================
// POST DETAIL / COMMENTS MODAL
// ============================================================
async function openPost(postId) {
    activeModalPostId = postId;
    const modal = document.getElementById('postModal');
    modal.classList.remove('hidden');
    document.getElementById('modalPost').innerHTML = '<p>Loading…</p>';
    document.getElementById('modalComments').innerHTML = '';
    document.getElementById('commentInput').value = '';

    // We don't have a single-post endpoint, so pull from feed/global as fallback
    let post = findPostInDom(postId);
    if (post) {
        document.getElementById('modalPost').innerHTML = postHtml(post);
    }
    loadComments(postId);
}

function findPostInDom(postId) {
    const el = document.querySelector(`.post[data-post-id="${postId}"]`);
    if (!el) return null;
    // Reconstruct minimal post object from DOM for redisplay in modal
    const author = el.querySelector('.post-author').textContent;
    const avatarColor = el.querySelector('.post-avatar').style.background;
    const content = el.querySelector('.post-content').textContent;
    const liked = el.querySelector('.action-btn').classList.contains('liked');
    const likeCount = el.querySelector('.like-count').textContent;
    const time = el.querySelector('.post-time').textContent.replace('· ', '');
    const authorId = el.querySelector('.post-avatar').getAttribute('onclick').match(/\d+/)[0];
    const isMine = currentUser && parseInt(authorId) === currentUser.id;
    return {
        id: postId,
        content,
        createdAtRaw: time,
        author: { id: authorId, username: author, avatarColor },
        likeCount,
        likedByMe: liked,
        commentCount: el.querySelector('.post-actions button:nth-child(2) span').textContent,
        _fromDom: true,
        isMine
    };
}

function closeModal() {
    document.getElementById('postModal').classList.add('hidden');
    activeModalPostId = null;
}
function closeModalOnOverlay(e) {
    if (e.target.id === 'postModal') closeModal();
}

async function loadComments(postId) {
    try {
        const { comments } = await api(`/posts/${postId}/comments`);
        const container = document.getElementById('modalComments');
        if (!comments.length) {
            container.innerHTML = `<p class="empty-state">No comments yet. Start the conversation!</p>`;
            return;
        }
        container.innerHTML = comments.map(c => `
            <div class="comment">
                <div class="comment-avatar" style="background:${c.author.avatarColor}">${c.author.username.charAt(0).toUpperCase()}</div>
                <div class="comment-body">
                    <div class="comment-author">${escapeHtml(c.author.username)}
                        ${currentUser && c.author.id === currentUser.id ? `<span style="float:right;cursor:pointer;color:var(--ink-soft);font-size:11px" onclick="deleteComment(${c.id}, ${postId})">remove</span>` : ''}
                    </div>
                    <div class="comment-text">${escapeHtml(c.content)}</div>
                    <div class="comment-time">${timeAgo(c.createdAt)}</div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error(err);
    }
}

async function submitComment() {
    const input = document.getElementById('commentInput');
    const content = input.value.trim();
    if (!content || !activeModalPostId) return;
    try {
        await api(`/posts/${activeModalPostId}/comments`, { method: 'POST', body: JSON.stringify({ content }) });
        input.value = '';
        loadComments(activeModalPostId);
        // refresh comment count in underlying feed without full reload
        const el = document.querySelector(`.post[data-post-id="${activeModalPostId}"] .post-actions button:nth-child(2) span`);
        if (el) el.textContent = parseInt(el.textContent) + 1;
    } catch (err) {
        alert(err.message);
    }
}

async function deleteComment(commentId, postId) {
    if (!confirm('Remove this comment?')) return;
    try {
        await api(`/comments/${commentId}`, { method: 'DELETE' });
        loadComments(postId);
        const el = document.querySelector(`.post[data-post-id="${postId}"] .post-actions button:nth-child(2) span`);
        if (el) el.textContent = Math.max(0, parseInt(el.textContent) - 1);
    } catch (err) {
        alert(err.message);
    }
}

// ============================================================
// PROFILE
// ============================================================
async function loadProfile(userId) {
    currentProfileId = userId;
    document.getElementById('feedView').classList.add('hidden');
    document.getElementById('profileView').classList.remove('hidden');
    document.getElementById('editProfileCard').classList.add('hidden');

    try {
        const { user } = await api(`/users/${userId}`);
        const isMe = currentUser && user.id === currentUser.id;

        document.getElementById('profileAvatar').style.background = user.avatarColor;
        document.getElementById('profileAvatar').textContent = user.username.charAt(0).toUpperCase();
        document.getElementById('profileUsername').textContent = user.username;
        document.getElementById('profileBio').textContent = user.bio || (isMe ? 'No bio yet — add one!' : 'No bio yet.');
        document.getElementById('profilePostCount').textContent = user.postCount;
        document.getElementById('profileFollowerCount').textContent = user.followerCount;
        document.getElementById('profileFollowingCount').textContent = user.followingCount;

        const followBtn = document.getElementById('followBtn');
        const editBtn = document.getElementById('editProfileBtn');
        if (isMe) {
            followBtn.classList.add('hidden');
            editBtn.classList.remove('hidden');
        } else {
            followBtn.classList.remove('hidden');
            editBtn.classList.add('hidden');
            followBtn.textContent = user.isFollowing ? 'Following ✓' : 'Follow';
            followBtn.className = user.isFollowing ? 'secondary-btn small' : 'primary-btn small';
        }

        const { posts } = await api(`/users/${userId}/posts`);
        renderPosts(posts, document.getElementById('profilePostsContainer'),
            `<div class="empty-state"><span class="emoji">📝</span>${isMe ? "You haven't" : `${escapeHtml(user.username)} hasn't`} posted anything yet.</div>`);
    } catch (err) {
        console.error(err);
    }
}

async function toggleFollow() {
    if (!currentProfileId) return;
    try {
        const { following } = await api(`/users/${currentProfileId}/follow`, { method: 'POST' });
        const btn = document.getElementById('followBtn');
        btn.textContent = following ? 'Following ✓' : 'Follow';
        btn.className = following ? 'secondary-btn small' : 'primary-btn small';
        const countEl = document.getElementById('profileFollowerCount');
        countEl.textContent = parseInt(countEl.textContent) + (following ? 1 : -1);
    } catch (err) {
        alert(err.message);
    }
}

// ------------------------------------------------------------
// EDIT PROFILE
// ------------------------------------------------------------
function openEditProfile() {
    document.getElementById('editBioInput').value = document.getElementById('profileBio').textContent.replace('No bio yet — add one!', '');
    document.getElementById('editProfileCard').classList.remove('hidden');
}
function closeEditProfile() {
    document.getElementById('editProfileCard').classList.add('hidden');
}
async function saveProfile() {
    const bio = document.getElementById('editBioInput').value.trim();
    try {
        await api(`/users/${currentUser.id}`, { method: 'PUT', body: JSON.stringify({ bio }) });
        closeEditProfile();
        loadProfile(currentUser.id);
    } catch (err) {
        alert(err.message);
    }
}

// ============================================================
// FOLLOW LISTS (followers / following)
// ============================================================
async function openFollowList(type) {
    if (!currentProfileId) return;
    const modal = document.getElementById('followModal');
    const title = document.getElementById('followModalTitle');
    const list = document.getElementById('followModalList');
    title.textContent = type === 'followers' ? 'Followers' : 'Following';
    list.innerHTML = '<p class="empty-state">Loading…</p>';
    modal.classList.remove('hidden');

    try {
        const { users } = await api(`/users/${currentProfileId}/${type}`);
        if (!users.length) {
            list.innerHTML = `<p class="empty-state">${type === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p>`;
            return;
        }
        list.innerHTML = users.map(u => `
            <div class="follow-row" onclick="closeFollowModal(); navigateTo('profile', ${u.id})">
                <div class="follow-row-avatar" style="background:${u.avatarColor}">${u.username.charAt(0).toUpperCase()}</div>
                <div>
                    <div class="follow-row-name">${escapeHtml(u.username)}</div>
                    <div class="follow-row-bio">${escapeHtml(u.bio || '')}</div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error(err);
    }
}
function closeFollowModal() {
    document.getElementById('followModal').classList.add('hidden');
}
function closeFollowModalOnOverlay(e) {
    if (e.target.id === 'followModal') closeFollowModal();
}

// ============================================================
// UTILITIES
// ============================================================
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

function timeAgo(dateStr) {
    if (!dateStr) return '';
    // SQLite CURRENT_TIMESTAMP is UTC without timezone marker — append 'Z'
    const date = new Date(dateStr.includes('Z') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
}
