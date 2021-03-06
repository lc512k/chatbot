// Description:
//   Provides price information for companies from global stock exchanges
//
// Commands:
//   hubot topics <query> - Displays FT topics that match your search query
//   hubot search <string> - Displays latest articles for topics matching your search (either a topic number, name, or free text).
//   hubot article <id> - Displays details of the specified article, e.g. article A2
//   hubot A<id> - Displays details of the specified article, e.g. A2
//   hubot topic <id> - Displays details of the specified topic, e.g. topic T4
//   hubot T<id> - Displays details of the specified topic, e.g. T4

// NB, some topics commands are handled by contextmanager

var API = require("../lib/ftapis");
var numbers = require('../lib/numberedlist');
var moment = require('moment');

var articleFormatter  = function(obj) {
	var pub = moment(obj.lastPublishDateTime).fromNow();
	var url = ('shorturl' in obj)? obj.shorturl : obj.url;
	return obj.title + ', _published ' + pub + '_ (' + url + ')';
};

var articleFullerFormatter  = function(obj) {
	var pub = moment(obj.lastPublishDateTime).fromNow();
	var url = obj.shorturl || obj.url;
	var excerpt = obj.excerpt || '';
	return "*" + obj.title + '*\n' + url + ', _published ' + pub + '_\n' + excerpt;
};

var articleIdentifier = function(obj) { return obj.uuid; };

var shortenArticlesUrl = function(articles) {
	return articles.map(function(obj) {
		if ('shorturl' in obj) {
			return obj;
		} else {
			return API.shorturls.shorten(obj.url).then(function(shorturl) {
				obj.shorturl = shorturl;
				return obj;
			});
		}
	});
};

var shortenArticlesWithIdsUrl = function(articles) {
	return articles.map(function(obj) {
		var article = obj[0];
		var idx     = obj[1];

		if ('shorturl' in article) {
			return obj;
		} else {
			return API.shorturls.shorten(article.url).then(function(shorturl) {
				article.shorturl = shorturl;
				return obj;
			});
		}
	});
};

var handleSearch = function(res, term) {

	if (!term) { // either get term as a parm, or read it from res
		term = res.match[2];
	}

	var originalTerm = term; // cos we may throw away the term value later

	var storyContext = require('../lib/scopedlist').getStoryContext(res);
	var topicContext = require('../lib/scopedlist').getTopicContext(res);

	// Log the query to the database
	res = require('../lib/autolog')(res);

	var termIsaTopic      = false;
	var termIsaSymbol     = false;
	var expandedTopicName = '';

	if(! term) {
		res.send('You need to specify a word or phrase to search for, or a topic id, e.g. search bear market, or search T2');
		return;
	} else if (topicContext.isValidIndex(term)) {
		// handle a numbered tag
		termIsaTopic = true;
		term = topicContext.get(term);
		if (!term) {
			res.send('Unknown topic. Say `topics` to find out what topics I already found for you, or `topics something` to find one.');
			return;
		}
	} else if (/^\w{2,5}\:\w{3}$/.test(term)) {
		termIsaSymbol = true;
	} else if (/^(organisations|topics|people|regions):.+$/.test(term)) {
		termIsaTopic = true;
	}

	Promise.resolve()
		.then(function() {
			if (termIsaSymbol) {
				return API.pricing.getSecurityInfo(term).then(function(company) {
					term = company.basic.name;
					return term;
				}).catch(function() {
					return term;
				});
			} else {
				return term;
			}
		})
		.then(function(queryStr) {
			return (termIsaTopic ? API.search.byTag(queryStr) : API.search.byText(queryStr));
		})
		.then(function(articles) {
			return Promise.all(shortenArticlesUrl(articles));
		})
		.then(function(articles) {
			if (articles.length) {
				res.send('Latest articles for *' + term + '*' + expandedTopicName + ":\n" + numbers(storyContext.add(articles, articleIdentifier), articleFormatter) );
			} else {
				res.send('No articles found for *' + term + '*' + expandedTopicName + '.  Try a topic, or the name of a company, industry or person.');
			}

			if (termIsaTopic) {
				API.primaryThemes.getRelatedThemes(term).then(function(suggestions) {
					if (suggestions) {
						suggestions = suggestions.slice(0,API.listLength.short);
						var topicContext = require('../lib/scopedlist').getTopicContext(res);
						if (suggestions.length > 0) {
							res.send('Related topics for *' + term + '*:\n' + numbers(topicContext.add(suggestions)) + '\nTo follow a topic, say for example `follow T3`');
						} else {
							res.send('No related topics for *' + term + '*');
						}
					}
				});
			} else {
				API.topicsuggest.getSuggestions(term).then(function(suggestions) {
					if (suggestions) {
						suggestions = suggestions.slice(0,API.listLength.short);
						var topicContext = require('../lib/scopedlist').getTopicContext(res);
						if (suggestions.length > 0) {
							res.send('Topic suggestions for *' + term + '*:\n' + numbers(topicContext.add(suggestions)) + '\nTo follow a topic, say for example `follow T3`');
						} else {
							res.send('No topic suggestions for *' + term + '*');
						}
					}
				});
			}
		})
		.catch(function(err) {
			res.send('Unable to load results for *' + term + '*');
			console.log(err, err.stack);
		})
	;
};


module.exports = function (robot) {

	robot.respond(/(topics|suggest)\s+(\S.*)/i, function (res) {
		res = require('../lib/autolog')(res); // Log the query to the database

		var term = res.match[2].toLowerCase();

		if (term === 'all' || term === 'clear') return;

		var topicContext = require('../lib/scopedlist').getTopicContext(res);

		API.topicsuggest.getSuggestions(term).then(function(suggestions) {
			if (suggestions.length > 0) {
				suggestions = suggestions.slice(0,API.listLength.short);
				res.send('FT topics matching *' + term + '*:\n' + numbers(topicContext.add(suggestions)) + '\nTo follow a topic, say for example `follow T3`');
			} else {
				res.send('Nothing found for *' + term + '*.  Try a topic, or the name of a company, industry or person.');
			}
		});
	});

	robot.respond(/(latest|search)$/i, function(res){
		res = require('../lib/autolog')(res);
		var mode = res.match[1];
		res.send('You need to specify a search term or a topic, e.g. ' + mode + ' collapse, or ' + mode + ' T2');
	});

	robot.respond(/(latest|search)\s+(.*)$/i, handleSearch );

	robot.respond(/(topic|T)$/i, function(res){
		res = require('../lib/autolog')(res);
		var mode = res.match[1];
		res.send('You need to specify a topic, e.g. topic T3, or T3');
	});

	robot.respond(/(?:topic\s+T?|T)?\s*(\d+)/i, function(res) {
		res = require('../lib/autolog')(res);
		var term = res.match[1];
		return handleSearch(res, term);
	});

	robot.respond(/(article|A)$/i, function(res){
		res = require('../lib/autolog')(res);
		var mode = res.match[1];
		res.send('You need to specify an article, e.g. article A3, or A3');
	});

	robot.respond(/(?:article\s+A?|A)\s*(\d+)/i, function (res) {
		res = require('../lib/autolog')(res);
		var storyContext = require('../lib/scopedlist').getStoryContext(res);
		var term = res.match[1];
		var	article = storyContext.get(term);

		if (!article) {
			res.send('Could not identify an article from *' + term + '*');
		} else {
			var topicContext = require('../lib/scopedlist').getTopicContext(res);
			var tags         = article.tags; // tags aka topics are already part of the stored article data
			var topicDetails = '';

			if (tags && tags.length > 0) {
				topicDetails = '\n\nRelated topics:\n' + numbers(topicContext.add(tags));
			}

			res.send(articleFullerFormatter(article) + topicDetails);
		}
	});
};
