const express = require('express');
const router = express.Router();
const newsController = require('../controllers/news.controller');

router.get('/', newsController.getAllNewsArticles);
router.get('/:type', newsController.getAllNewsArticlesByType);
// router.post('/', userController.createUser);

module.exports = router;