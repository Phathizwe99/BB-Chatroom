// API Base URL
const API_BASE = '/api';
const DEFAULT_AVATAR = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22%3E%3Crect width=%2280%22 height=%2280%22 rx=%2240%22 fill=%22%23e5f2ed%22/%3E%3Ccircle cx=%2240%22 cy=%2229%22 r=%2213%22 fill=%22%2394b9aa%22/%3E%3Cpath d=%22M15 73c2-16 11-24 25-24s23 8 25 24%22 fill=%22%2394b9aa%22/%3E%3C/svg%3E';

// Global state
let currentUser = null;
let token = null;
let feedController = null;
let searchController = null;
let feedRequestId = 0;
let profileRequestId = 0;
let searchRequestId = 0;
const commentCache = new Map();
const pendingLikes = new Set();
let postElementSequence = 0;

function normalizeUser(user) {
  return user ? { ...user, id: user.id || user._id } : null;
}

function safeImageUrl(value) {
  if (typeof value !== 'string') return DEFAULT_AVATAR;
  const url = value.trim();
  if (/^https?:\/\//i.test(url) || url.startsWith('data:image/') || url.startsWith('/')) return url;
  return DEFAULT_AVATAR;
}

async function apiRequest(path, { method = 'GET', body, auth = true, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token) headers.Authorization = ['Bearer', token].join(' ');

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Network error. Check your connection and try again.');
  }

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && auth) handleLogout();
    throw new Error(data?.message || data?.error || `Request failed (${response.status})`);
  }
  return data;
}

function setBusy(button, busy, label = 'Working…') {
  if (!button) return;
  if (busy) {
    if (button.dataset.busy === '1') return;
    button.dataset.busy = '1';
    button.dataset.idleHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> ${escapeHtml(label)}`;
  } else if (button.dataset.busy === '1') {
    button.disabled = false;
    button.innerHTML = button.dataset.idleHtml;
    delete button.dataset.busy;
    delete button.dataset.idleHtml;
  }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupEventListeners();
});

// Check authentication
function checkAuth() {
  try {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    const user = storedUser ? normalizeUser(JSON.parse(storedUser)) : null;
    if (!storedToken || !user?.id) throw new Error('Saved session is incomplete.');
    token = storedToken;
    currentUser = user;
    showMainApp();
    navigateTo('home');
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    token = null;
    currentUser = null;
    showAuth();
  }
}

// Setup global event listeners
function setupEventListeners() {
  // Auth toggles
  document.getElementById('show-register')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
  });
  
  document.getElementById('show-login')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
  });
  
  // Login form
  document.getElementById('login-form-element')?.addEventListener('submit', handleLogin);
  document.getElementById('register-form-element')?.addEventListener('submit', handleRegister);
  
  // Logout
  document.querySelectorAll('[data-logout]').forEach(button => {
    button.addEventListener('click', handleLogout);
  });
  
  // Navigation
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      const view = btn.dataset.view;
      navigateTo(view);
    });
  });
  
  // Create post
  document.getElementById('create-post-btn')?.addEventListener('click', createPost);
  document.getElementById('refresh-feed-btn')?.addEventListener('click', loadFeed);
  document.getElementById('feed-sort')?.addEventListener('change', loadFeed);
  document.getElementById('post-content')?.addEventListener('input', updateCharacterCount);
  document.getElementById('post-content')?.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      createPost();
    }
  });
  
  // Search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(handleSearch, 500));
  }
}

// Debounce helper
function debounce(func, delay) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

// Auth functions
async function handleLogin(e) {
  e.preventDefault();
  const submit = e.currentTarget.querySelector('button[type="submit"]');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) {
    showToast('Enter your email and password.');
    return;
  }
  
  setBusy(submit, true, 'Signing in…');
  try {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      auth: false,
      body: { email, password }
    });
    if (!data?.token || !data?.user) throw new Error('Unexpected response from the server.');
    token = data.token;
    currentUser = normalizeUser(data.user);
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(currentUser));
    
    showMainApp();
    navigateTo('home');
    showToast('Welcome back.');
  } catch (err) {
    showToast(err.message);
  } finally {
    setBusy(submit, false);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const submit = e.currentTarget.querySelector('button[type="submit"]');
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const name = document.getElementById('reg-name').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!username || !email || !name || !password) {
    showToast('Please fill in every field.');
    return;
  }
  if (password.length < 8) {
    showToast('Choose a password with at least 8 characters.');
    return;
  }

  setBusy(submit, true, 'Creating account…');
  try {
    const data = await apiRequest('/auth/register', {
      method: 'POST',
      auth: false,
      body: { username, email, name, password }
    });
    if (!data?.token || !data?.user) throw new Error('Unexpected response from the server.');
    token = data.token;
    currentUser = normalizeUser(data.user);
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(currentUser));
    
    showMainApp();
    navigateTo('home');
    showToast('Welcome to the circle.');
  } catch (err) {
    showToast(err.message);
  } finally {
    setBusy(submit, false);
  }
}

function handleLogout() {
  feedController?.abort();
  searchController?.abort();
  commentCache.clear();
  pendingLikes.clear();
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  token = null;
  currentUser = null;
  showAuth();
  showToast('Signed out.');
}

// UI navigation
function showAuth() {
  document.getElementById('auth-container').style.display = 'flex';
  document.getElementById('main-container').style.display = 'none';
}

function showMainApp() {
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('main-container').style.display = 'flex';
  updateSidebarProfile();
}

function navigateTo(view, userId = currentUser?.id) {
  const viewIds = ['feed-view', 'chats-view', 'communities-view', 'search-view', 'profile-view'];
  const viewTargets = {
    home: 'feed-view',
    feed: 'feed-view',
    chats: 'chats-view',
    communities: 'communities-view',
    discover: 'search-view',
    search: 'search-view',
    profile: 'profile-view'
  };
  const targetId = viewTargets[view];
  if (!targetId) return;

  // Hide all views
  viewIds.forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    const isActive = viewTargets[btn.dataset.view] === targetId;
    btn.classList.toggle('active', isActive);
    if (isActive) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  
  // Show selected view
  document.getElementById(targetId).style.display = 'block';
  if (targetId === 'feed-view') {
    loadFeed();
  } else if (targetId === 'profile-view') {
    loadProfile(userId);
  } else if (targetId === 'search-view') {
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-input').value = '';
  }
}

function updateSidebarProfile() {
  if (!currentUser) return;
  const name = document.getElementById('sidebar-name');
  const username = document.getElementById('sidebar-username');
  const avatar = document.getElementById('sidebar-avatar');
  if (name) name.textContent = currentUser.name || currentUser.username || 'Black Bulls member';
  if (username) username.textContent = currentUser.username ? `@${currentUser.username}` : '';
  if (avatar) {
    avatar.src = safeImageUrl(currentUser.profilePicture);
    applyAvatarFallbacks(avatar.parentElement);
  }
}

// Feed functions
async function loadFeed() {
  const container = document.getElementById('posts-container');
  const requestId = ++feedRequestId;
  feedController?.abort();
  feedController = new AbortController();
  const controller = feedController;
  container.setAttribute('aria-busy', 'true');
  container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading posts...</div>';
  
  try {
    const response = await fetch(`${API_BASE}/posts/feed`, {
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load feed');
    const posts = await response.json();
    if (controller.signal.aborted || requestId !== feedRequestId) return;
    const sortMode = document.getElementById('feed-sort')?.value || 'newest';
    posts.sort((a, b) => {
      if (sortMode === 'popular') return (b.likes?.length || 0) - (a.likes?.length || 0);
      const timeDifference = new Date(b.createdAt) - new Date(a.createdAt);
      return sortMode === 'oldest' ? -timeDifference : timeDifference;
    });
    
    if (posts.length === 0) {
      container.innerHTML = '<div class="loading">No posts yet. Follow some users or create your first post!</div>';
      return;
    }
    
    const commentResults = await Promise.allSettled(posts.map(post => fetchComments(post._id)));
    if (controller.signal.aborted || requestId !== feedRequestId) return;
    if (commentResults.some(result => result.status === 'rejected')) {
      showToast('Some comments could not be loaded. Refresh to try again.');
    }
    const postElements = posts.map((post, index) => {
      const result = commentResults[index];
      return createPostElement(post, result.status === 'fulfilled' ? result.value : []);
    });
    container.replaceChildren(...postElements);
  } catch (err) {
    if (err.name === 'AbortError' || requestId !== feedRequestId) return;
    container.innerHTML = `<div class="loading">Couldn't load your feed. ${escapeHtml(err.message)}</div>`;
  } finally {
    if (feedController === controller) {
      feedController = null;
      container.removeAttribute('aria-busy');
    }
  }
}

async function fetchComments(postId) {
  const comments = await apiRequest(`/comments/${encodeURIComponent(postId)}`, { auth: false });
  if (!Array.isArray(comments)) throw new Error('The comments response was invalid.');
  commentCache.set(postId, comments);
  return comments;
}

function createPostElement(post, comments) {
  const author = post.author || {};
  const postId = post._id;
  const commentSectionId = `post-comments-${postElementSequence++}`;
  const commentInputId = `${commentSectionId}-input`;
  const safeComments = Array.isArray(comments) ? comments : [];
  if (!commentCache.has(postId)) commentCache.set(postId, safeComments);
  const postDiv = document.createElement('article');
  postDiv.className = 'post-card';
  postDiv.dataset.postId = postId;
  
  const isLiked = post.likedByCurrentUser || post.likes?.some(l => (typeof l === 'string' ? l : l?._id) === currentUser.id);
  
  postDiv.innerHTML = `
    <div class="post-header">
      <img src="${escapeHtml(safeImageUrl(author.profilePicture))}" class="post-avatar" alt="">
      <div class="post-author-info">
        <div class="post-author-name" data-user-id="${escapeHtml(author._id)}" role="link" tabindex="0">${escapeHtml(author.name || 'Unknown member')}</div>
        <div class="post-author-username">@${escapeHtml(author.username || '')}</div>
      </div>
      <time class="post-date" datetime="${escapeHtml(post.createdAt)}">${formatDate(post.createdAt)}</time>
      ${author._id === currentUser.id ? '<button type="button" class="btn-danger delete-post-btn" aria-label="Delete post"><i class="fas fa-trash" aria-hidden="true"></i></button>' : ''}
    </div>
    <div class="post-content">${escapeHtml(post.content)}</div>
    <div class="post-actions">
      <button type="button" class="action-btn like-btn ${isLiked ? 'liked' : ''}" aria-pressed="${Boolean(isLiked)}" aria-label="${isLiked ? 'Unlike post' : 'Like post'}">
        <i class="fas fa-heart" aria-hidden="true"></i>
        <span class="like-count">${post.likes?.length || 0}</span>
      </button>
      <button type="button" class="action-btn comment-toggle-btn" aria-expanded="false" aria-controls="${commentSectionId}">
        <i class="fas fa-comment" aria-hidden="true"></i>
        <span class="comment-count">${safeComments.length}</span>
      </button>
    </div>
    <div class="comments-section" id="${commentSectionId}" style="display:none">
      <div class="comments-list"></div>
      <form class="add-comment">
        <label class="sr-only" for="${commentInputId}">Write a comment</label>
        <input id="${commentInputId}" type="text" placeholder="Write a comment..." class="comment-input" maxlength="500" required>
        <button type="submit" class="btn-secondary add-comment-btn">Comment</button>
      </form>
    </div>
  `;
  applyAvatarFallbacks(postDiv);
  
  // Setup event listeners
  const likeBtn = postDiv.querySelector('.like-btn');
  likeBtn.addEventListener('click', () => toggleLike(postId, likeBtn));
  
  const commentToggle = postDiv.querySelector('.comment-toggle-btn');
  const commentsSection = postDiv.querySelector('.comments-section');
  commentToggle.addEventListener('click', () => {
    const isVisible = commentsSection.style.display === 'block';
    commentsSection.style.display = isVisible ? 'none' : 'block';
    commentToggle.setAttribute('aria-expanded', String(!isVisible));
    if (!isVisible) {
      renderComments(commentsSection.querySelector('.comments-list'), commentCache.get(postId) || safeComments, postId);
    }
  });
  
  postDiv.querySelector('.add-comment').addEventListener('submit', event => {
    event.preventDefault();
    addComment(postId, event.currentTarget.querySelector('.comment-input').value, commentsSection);
  });
  
  const deleteBtn = postDiv.querySelector('.delete-post-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => deletePost(postId, postDiv));
  }
  
  // Author name click
  const authorName = postDiv.querySelector('.post-author-name');
  authorName.addEventListener('click', () => {
    const userId = authorName.dataset.userId;
    showUserProfile(userId);
  });
  authorName.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      showUserProfile(authorName.dataset.userId);
    }
  });
  
  return postDiv;
}

function renderComments(container, comments, postId) {
  const safeComments = Array.isArray(comments) ? comments : [];
  commentCache.set(postId, safeComments);
  if (safeComments.length === 0) {
    container.innerHTML = '<div class="comment">No comments yet. Be the first!</div>';
    return;
  }
  
  container.innerHTML = safeComments.map(comment => {
    const author = comment.author || {};
    const ownsComment = author._id === currentUser.id;
    return `
    <div class="comment" data-comment-id="${comment._id}">
      <div class="comment-content">
        <div class="comment-author" data-user-id="${escapeHtml(author._id)}" role="link" tabindex="0">${escapeHtml(author.name || 'Unknown member')}</div>
        <div class="comment-text">${escapeHtml(comment.text)}</div>
        <time class="comment-date" datetime="${escapeHtml(comment.createdAt)}">${formatDate(comment.createdAt)}</time>
      </div>
      ${ownsComment ? `
        <button type="button" class="comment-delete" data-comment-id="${escapeHtml(comment._id)}" aria-label="Delete comment">
          <i class="fas fa-trash-alt" aria-hidden="true"></i>
        </button>
      ` : ''}
    </div>
  `}).join('');
  
  container.querySelectorAll('.comment-author').forEach(el => {
    el.addEventListener('click', () => {
      const userId = el.dataset.userId;
      showUserProfile(userId);
    });
    el.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showUserProfile(el.dataset.userId);
      }
    });
  });
  container.querySelectorAll('.comment-delete').forEach(button => {
    button.addEventListener('click', () => deleteComment(button.dataset.commentId, button));
  });
}

async function toggleLike(postId, btnElement) {
  if (pendingLikes.has(postId)) return;
  pendingLikes.add(postId);
  const isLiked = btnElement.classList.contains('liked');
  const likeCountSpan = btnElement.querySelector('.like-count');
  const previousCount = Number(likeCountSpan.textContent) || 0;
  btnElement.classList.toggle('liked', !isLiked);
  btnElement.setAttribute('aria-pressed', String(!isLiked));
  btnElement.setAttribute('aria-label', isLiked ? 'Like post' : 'Unlike post');
  likeCountSpan.textContent = Math.max(0, previousCount + (isLiked ? -1 : 1));
  const url = `${API_BASE}/posts/${postId}/${isLiked ? 'like' : 'like'}`;
  const method = isLiked ? 'DELETE' : 'POST';
  
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to toggle like');
    const data = await response.json();
    
    btnElement.classList.toggle('liked', !isLiked);
    btnElement.setAttribute('aria-pressed', String(!isLiked));
    if (typeof data.likesCount === 'number') likeCountSpan.textContent = data.likesCount;
  } catch (err) {
    btnElement.classList.toggle('liked', isLiked);
    btnElement.setAttribute('aria-pressed', String(isLiked));
    btnElement.setAttribute('aria-label', isLiked ? 'Unlike post' : 'Like post');
    likeCountSpan.textContent = previousCount;
    showToast(err.message);
  } finally {
    pendingLikes.delete(postId);
  }
}

async function addComment(postId, text, commentsSection) {
  if (!text.trim()) return;
  
  try {
    const response = await fetch(`${API_BASE}/comments/${postId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ text })
    });
    
    if (!response.ok) throw new Error('Failed to add comment');
    const newComment = await response.json();
    
    // Refresh comments
    const comments = await fetchComments(postId);
    const commentsList = commentsSection.querySelector('.comments-list');
    renderComments(commentsList, comments, postId);
    
    // Clear input
    commentsSection.querySelector('.comment-input').value = '';
    
    // Update comment count
    const commentCountSpan = commentsSection.closest('.post-card').querySelector('.comment-count');
    commentCountSpan.textContent = comments.length;
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteComment(commentId, btnElement) {
  if (!confirm('Delete this comment?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/comments/${commentId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to delete comment');
    
    const commentDiv = btnElement.closest('.comment');
    const postCard = commentDiv.closest('.post-card');
    const postId = postCard.dataset.postId;
    commentDiv.remove();
    const remainingComments = (commentCache.get(postId) || []).filter(comment => comment._id !== commentId);
    commentCache.set(postId, remainingComments);
    
    // Update comment count
    const commentsList = postCard.querySelector('.comments-list');
    if (remainingComments.length === 0 && commentsList) {
      commentsList.innerHTML = '<div class="comment">No comments yet. Be the first!</div>';
    }
    const commentCount = remainingComments.length;
    postCard.querySelector('.comment-count').textContent = commentCount;
  } catch (err) {
    showToast(err.message);
  }
}

async function deletePost(postId, postElement) {
  if (!confirm('Delete this post?')) return;
  
  try {
    const response = await fetch(`${API_BASE}/posts/${postId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to delete post');
    postElement.remove();
  } catch (err) {
    showToast(err.message);
  }
}

async function createPost() {
  const content = document.getElementById('post-content').value;
  if (!content.trim()) {
    showToast('Add a little something before sharing.');
    return;
  }
  const postButton = document.getElementById('create-post-btn');
  setBusy(postButton, true, 'Sharing…');
  
  try {
    const response = await fetch(`${API_BASE}/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ content })
    });
    
    if (!response.ok) throw new Error('Failed to create post');
    
    document.getElementById('post-content').value = '';
    updateCharacterCount();
    navigateTo('feed');
    showToast('Your post is live.');
  } catch (err) {
    showToast(err.message);
  } finally {
    setBusy(postButton, false);
  }
}

// Profile functions
async function loadProfile(userId, isOwnProfile = false) {
  const requestId = ++profileRequestId;
  const profileHeader = document.getElementById('profile-header');
  const profilePosts = document.getElementById('profile-posts');
  
  profileHeader.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading profile...</div>';
  profilePosts.innerHTML = '';
  
  try {
    // Fetch profile data
    const profileResponse = await fetch(`${API_BASE}/users/${userId}/profile`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!profileResponse.ok) throw new Error('Failed to load profile');
    const userProfile = await profileResponse.json();
    if (requestId !== profileRequestId) return;
    
    // Fetch user posts
    const postsResponse = await fetch(`${API_BASE}/users/${userId}/posts`);
    if (!postsResponse.ok) throw new Error('Failed to load posts');
    const userPosts = await postsResponse.json();
    if (requestId !== profileRequestId) return;
    
    // Render profile header
    const isOwn = userProfile._id === currentUser.id;
    const isFollowing = userProfile.followStatus;
    
    profileHeader.innerHTML = `
      <img src="${escapeHtml(safeImageUrl(userProfile.profilePicture))}" class="profile-avatar" alt="">
      <h1 class="profile-name">${escapeHtml(userProfile.name)}</h1>
      <div class="profile-username">@${escapeHtml(userProfile.username)}</div>
      <div class="profile-bio">${escapeHtml(userProfile.bio || 'No bio yet')}</div>
      <div class="profile-stats">
        <div class="stat"><div class="stat-number">${userProfile.followerCount}</div><div class="stat-label">Followers</div></div>
        <div class="stat"><div class="stat-number">${userProfile.followingCount}</div><div class="stat-label">Following</div></div>
        <div class="stat"><div class="stat-number">${userPosts.length}</div><div class="stat-label">Posts</div></div>
      </div>
      ${isOwn ? `
        <button type="button" class="btn-secondary edit-profile-btn"><i class="fas fa-edit" aria-hidden="true"></i> Edit profile</button>
        <form id="edit-profile-form" style="display:none" class="edit-profile-form">
          <input type="text" id="edit-name" placeholder="Name" aria-label="Name" maxlength="60" value="${escapeHtml(userProfile.name)}" required>
          <textarea id="edit-bio" placeholder="Bio" aria-label="Bio" rows="3" maxlength="160">${escapeHtml(userProfile.bio || '')}</textarea>
          <input type="url" id="edit-avatar" placeholder="Profile picture URL" aria-label="Profile picture URL" value="${escapeHtml(userProfile.profilePicture || '')}">
          <button type="submit" class="btn-primary">Save changes</button>
          <button type="button" class="btn-secondary" data-action="cancel-edit">Cancel</button>
        </form>
      ` : `
        <button type="button" class="btn-primary follow-btn ${isFollowing ? 'following' : ''}" data-user-id="${escapeHtml(userProfile._id)}">
          ${isFollowing ? 'Following' : 'Follow'}
        </button>
      `}
    `;
    applyAvatarFallbacks(profileHeader);
    profileHeader.querySelector('.edit-profile-btn')?.addEventListener('click', showEditProfile);
    profileHeader.querySelector('#edit-profile-form')?.addEventListener('submit', event => {
      event.preventDefault();
      updateProfile(userProfile._id);
    });
    profileHeader.querySelector('[data-action="cancel-edit"]')?.addEventListener('click', () => {
      profileHeader.querySelector('#edit-profile-form').style.display = 'none';
    });
    profileHeader.querySelector('.follow-btn')?.addEventListener('click', event => {
      toggleFollow(userProfile._id, event.currentTarget);
    });
    
    // Render posts
    if (userPosts.length === 0) {
      profilePosts.innerHTML = '<div class="loading">No posts yet.</div>';
    } else {
      profilePosts.innerHTML = '';
      const commentResults = await Promise.allSettled(userPosts.map(post => fetchComments(post._id)));
      if (requestId !== profileRequestId) return;
      if (commentResults.some(result => result.status === 'rejected')) {
        showToast('Some comments could not be loaded. Refresh the profile to try again.');
      }
      profilePosts.replaceChildren(...userPosts.map((post, index) => {
        const commentResult = commentResults[index];
        const likedByCurrentUser = post.likes?.some(like =>
          (typeof like === 'string' ? like : like?._id) === currentUser.id);
        return createPostElement(
          { ...post, likedByCurrentUser },
          commentResult.status === 'fulfilled' ? commentResult.value : []
        );
      }));
    }
  } catch (err) {
    if (requestId !== profileRequestId) return;
    profileHeader.innerHTML = `<div class="loading">Error: ${escapeHtml(err.message)}</div>`;
  }
}

async function toggleFollow(userId, btnElement) {
  const isFollowing = btnElement.classList.contains('following');
  const url = `${API_BASE}/users/${userId}/${isFollowing ? 'unfollow' : 'follow'}`;
  const method = isFollowing ? 'DELETE' : 'POST';
  
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to update follow status');
    
    btnElement.textContent = isFollowing ? 'Follow' : 'Following';
    btnElement.classList.toggle('following');
    
    // Reload profile to update counts
    loadProfile(userId);
  } catch (err) {
    showToast(err.message);
  }
}

function showEditProfile() {
  const form = document.getElementById('edit-profile-form');
  if (!form) return;
  const opening = form.style.display === 'none' || !form.style.display;
  form.style.display = opening ? 'grid' : 'none';
  if (opening) form.querySelector('#edit-name')?.focus();
}

async function updateProfile(userId) {
  const name = document.getElementById('edit-name').value;
  const bio = document.getElementById('edit-bio').value;
  const profilePicture = document.getElementById('edit-avatar').value;
  
  try {
    const response = await fetch(`${API_BASE}/users/${userId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name, bio, profilePicture })
    });
    
    if (!response.ok) throw new Error('Failed to update profile');
    const updatedUser = await response.json();
    
    // Update current user if it's the same
    if (userId === currentUser.id) {
      currentUser = { ...currentUser, ...updatedUser };
      localStorage.setItem('user', JSON.stringify(currentUser));
      updateSidebarProfile();
    }
    
    document.getElementById('edit-profile-form').style.display = 'none';
    loadProfile(userId);
  } catch (err) {
    showToast(err.message);
  }
}

function showUserProfile(userId) {
  navigateTo('profile', userId);
}

// Search functions
async function handleSearch(e) {
  const query = e.target.value.trim();
  const resultsContainer = document.getElementById('search-results');
  const requestId = ++searchRequestId;
  searchController?.abort();
  
  if (query.length < 2) {
    resultsContainer.innerHTML = query ? '<div class="loading">Keep typing to search.</div>' : '';
    return;
  }

  const controller = new AbortController();
  searchController = controller;
  resultsContainer.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Searching…</div>';
  
  try {
    const users = await apiRequest(`/users/search?q=${encodeURIComponent(query)}`, {
      auth: false,
      signal: controller.signal
    });
    if (controller.signal.aborted || requestId !== searchRequestId) return;
    if (!Array.isArray(users)) throw new Error('The search returned an unexpected response.');
    
    if (users.length === 0) {
      resultsContainer.innerHTML = '<div class="loading">No people found. Try another name or username.</div>';
      return;
    }
    
    resultsContainer.innerHTML = users.map(user => `
      <button type="button" class="search-result-item" data-user-id="${escapeHtml(user._id)}">
        <img src="${escapeHtml(safeImageUrl(user.profilePicture))}" class="search-result-avatar" alt="">
        <div class="search-result-info">
          <h4>${escapeHtml(user.name)}</h4>
          <p>@${escapeHtml(user.username)}</p>
        </div>
      </button>
    `).join('');
    resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => showUserProfile(item.dataset.userId));
    });
    applyAvatarFallbacks(resultsContainer);
  } catch (err) {
    if (err.name === 'AbortError' || requestId !== searchRequestId) return;
    resultsContainer.innerHTML = `<div class="loading">Search failed. ${escapeHtml(err.message)}</div>`;
  } finally {
    if (searchController === controller) searchController = null;
  }
}

// Helper functions
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  region.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

function applyAvatarFallbacks(container) {
  container.querySelectorAll('.post-avatar, .profile-avatar, .search-result-avatar, #sidebar-avatar').forEach(image => {
    image.addEventListener('error', () => {
      image.src = DEFAULT_AVATAR;
    }, { once: true });
  });
}

function updateCharacterCount() {
  const postInput = document.getElementById('post-content');
  const counter = document.getElementById('post-character-count');
  if (!postInput || !counter) return;
  counter.textContent = `${postInput.value.length} / ${postInput.maxLength}`;
  counter.classList.toggle('at-limit', postInput.value.length >= postInput.maxLength);
}
