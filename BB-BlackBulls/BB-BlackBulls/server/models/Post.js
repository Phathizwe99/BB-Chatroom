const express = require('express');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Follow = require('../models/Follow');
const auth = require('../middleware/auth');
const router = express.Router();

// Create a post
router.post('/', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const post = new Post({
      content,
      author: req.user.id
    });
    await post.save();
    await post.populate('author', 'username name profilePicture');
    res.status(201).json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get feed (posts from followed users + own posts)
router.get('/feed', auth, async (req, res) => {
  try {
    const following = await Follow.find({ follower: req.user.id }).select('following');
    const followingIds = following.map(f => f.following);
    followingIds.push(req.user.id);
    
    const posts = await Post.find({ author: { $in: followingIds } })
      .sort({ createdAt: -1 })
      .populate('author', 'username name profilePicture')
      .populate('likes', 'username')
      .lean();
    
    // Add like status for current user
    const postsWithLikeStatus = posts.map(post => ({
      ...post,
      likedByCurrentUser: post.likes.some(like => like._id.toString() === req.user.id)
    }));
    
    res.json(postsWithLikeStatus);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single post
router.get('/:id', async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'username name profilePicture')
      .populate('likes', 'username');
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    res.json(post);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a post
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    if (post.author.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You can only delete your own posts' });
    }
    
    await Comment.deleteMany({ post: post._id });
    await post.deleteOne();
    
    res.json({ message: 'Post deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Like a post
router.post('/:id/like', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    if (post.likes.includes(req.user.id)) {
      return res.status(400).json({ message: 'Already liked this post' });
    }
    
    post.likes.push(req.user.id);
    await post.save();
    
    res.json({ message: 'Post liked', likesCount: post.likes.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Unlike a post
router.delete('/:id/like', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }
    
    const likeIndex = post.likes.indexOf(req.user.id);
    if (likeIndex === -1) {
      return res.status(400).json({ message: 'Post not liked yet' });
    }
    
    post.likes.splice(likeIndex, 1);
    await post.save();
    
    res.json({ message: 'Post unliked', likesCount: post.likes.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;