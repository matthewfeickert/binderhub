/* If this file gets over 200 lines of code long (not counting docs / comments), start using a framework
  State transitions that are valid are:
  start -> waiting
  start -> built
  start -> failed
  waiting -> building
  waiting -> failed
  building -> pushing
  building -> failed
  pushing -> built
  pushing -> failed
*/
import * as Terminal from 'xterm';
import Clipboard from 'clipboard';
import 'xterm/lib/xterm.css';
import 'bootstrap';
import 'event-source-polyfill';

import BinderImage from './src/image';
import { markdownBadge, rstBadge } from './src/badge';
import { getPathType, updatePathText } from './src/path';

import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/css/bootstrap-theme.min.css';
import '../index.css';

// FIXME: Can not seem to import this addon from npm
// See https://github.com/xtermjs/xterm.js/issues/1018 for more details
import {fit} from './vendor/xterm/addons/fit';

var BASE_URL = $('#base-url').data().url;

function update_favicon(path) {
    var link = document.querySelector("link[rel*='icon']") || document.createElement('link');
    link.type = 'image/x-icon';
    link.rel = 'shortcut icon';
    link.href = path;
    document.getElementsByTagName('head')[0].appendChild(link);
}

function v2url(providerPrefix, repository, ref, path, pathType) {
  // return a v2 url from a providerPrefix, repository, ref, and (file|url)path
  if (repository.length === 0) {
    // no repo, no url
    return null;
  }
  var url = window.location.origin + BASE_URL + 'v2/' + providerPrefix + '/' + repository + '/' + ref;
  if (path && path.length > 0) {
    // encode the path, it will be decoded in loadingMain
    url = url + '?' + pathType + 'path=' + encodeURIComponent(path);
  }
  return url;
}

function updateRepoText() {
  var text;
  var provider = $("#provider_prefix").val();
  var tag_text = "Git branch, tag, or commit";
  if (provider === "gh") {
    text = "GitHub repository name or URL";
  } else if (provider === "gl") {
    text = "GitLab.com repository or URL";
  }
  else if (provider === "gist") {
    text = "Gist ID (username/gistId) or URL";
    tag_text = "Git commit SHA";
  }
  else if (provider === "git") {
    text = "Arbitrary git repository URL (http://git.example.com/repo)";
    tag_text = "Git commit SHA";
  }
  $("#repository").attr('placeholder', text);
  $("label[for=repository]").text(text);
  $("#ref").attr('placeholder', tag_text);
  $("label[for=ref]").text(tag_text);
}

function getBuildFormValues() {
  var providerPrefix = $('#provider_prefix').val().trim();
  var repo = $('#repository').val().trim();
  if (providerPrefix !== 'git') {
    repo = repo.replace(/^(https?:\/\/)?gist.github.com\//, '');
    repo = repo.replace(/^(https?:\/\/)?github.com\//, '');
    repo = repo.replace(/^(https?:\/\/)?gitlab.com\//, '');
  }
  // trim trailing or leading '/' on repo
  repo = repo.replace(/(^\/)|(\/?$)/g, '');
  // git providers encode the URL of the git repository as the repo
  // argument.
  if (repo.includes("://") || providerPrefix === 'gl') {
    repo = encodeURIComponent(repo);
  }

  var ref = $('#ref').val().trim() || 'master';
  var path = $('#filepath').val().trim();
  return {'providerPrefix': providerPrefix, 'repo': repo,
          'ref': ref, 'path': path, 'pathType': getPathType()}
}

function updateUrls(formValues) {
  if (typeof formValues === "undefined") {
      formValues = getBuildFormValues();
  }
  var url = v2url(
               formValues.providerPrefix,
               formValues.repo,
               formValues.ref,
               formValues.path,
               formValues.pathType
            );

  if ((url||'').trim().length > 0){
    // update URLs and links (badges, etc.)
    $("#badge-link").attr('href', url);
    $('#basic-url-snippet').text(url);
    $('#markdown-badge-snippet').text(markdownBadge(url));
    $('#rst-badge-snippet').text(rstBadge(url));
  } else {
    ['#basic-url-snippet', '#markdown-badge-snippet', '#rst-badge-snippet' ].map(function(item, ind){
      var el = $(item);
      el.text(el.attr('data-default'));
    })
  }
}

function build(providerSpec, log, path, pathType) {
  update_favicon(BASE_URL + "favicon_building.ico");
  // split provider prefix off of providerSpec
  var spec = providerSpec.slice(providerSpec.indexOf('/') + 1);

  // Update the text of the loading page if it exists
  if ($('div#loader-text').length > 0) {
    $('div#loader-text p').text("Starting repository: " + spec);
    window.setTimeout(function() {
      $('div#loader-text p').html("Repository " + spec + " is taking longer than usual to start, hang tight!")
    }, 17000);
  }

  $('#build-progress .progress-bar').addClass('hidden');
  log.clear();

  $('.on-build').removeClass('hidden');

  var image = new BinderImage(providerSpec);

  image.onStateChange('*', function(oldState, newState, data) {
    if (data.message !== undefined) {
      log.write(data.message);
      log.fit();
    } else {
      console.log(data);
    }
  });

  image.onStateChange('waiting', function(oldState, newState, data) {
    $('#phase-waiting').removeClass('hidden');
  });

  image.onStateChange('building', function(oldState, newState, data) {
    $('#phase-building').removeClass('hidden');
  });

  image.onStateChange('pushing', function(oldState, newState, data) {
    $('#phase-pushing').removeClass('hidden');
  });

  image.onStateChange('failed', function(oldState, newState, data) {
    $('#build-progress .progress-bar').addClass('hidden');
    $('#phase-failed').removeClass('hidden');

    $("#loader").addClass("paused");
    $('div#loader-text p').html("Repository " + spec + " has failed to load!<br />See the logs for details.");
    update_favicon(BASE_URL + "favicon_fail.ico");
    // If we fail for any reason, we will show logs!
    log.show();

    // Show error on loading page
    if ($('div#loader-text').length > 0) {
      $('#loader').addClass("error");
      $('div#loader-text p').html('Error loading ' + spec + '!<br /> See logs below for details.');
    }
    image.close();
  });

  image.onStateChange('built', function(oldState, newState, data) {
    if (oldState === null) {
      $('#phase-already-built').removeClass('hidden');
      $('#phase-launching').removeClass('hidden');
    }
    $('#phase-launching').removeClass('hidden');
    update_favicon(BASE_URL + "favicon_success.ico");
  });

  image.onStateChange('ready', function(oldState, newState, data) {
    image.close();
    // user server is ready, redirect to there
    image.launch(data.url, data.token, path, pathType);
  });

  image.fetch();
  return image;
}

function setUpLog() {
  var log = new Terminal({
    convertEol: true,
    disableStdin: true
  });

  log.open(document.getElementById('log'), false);
  log.fit();

  $(window).resize(function() {
    log.fit();
  });

  var $panelBody = $("div.panel-body");
  log.show = function () {
    $('#toggle-logs button').text('hide');
    $panelBody.removeClass('hidden');
  };

  log.hide = function () {
    $('#toggle-logs button').text('show');
    $panelBody.addClass('hidden');
  };

  log.toggle = function () {
    if ($panelBody.hasClass('hidden')) {
      log.show();
    } else {
      log.hide();
    }
  };

  $('#toggle-logs').click(log.toggle);
  return log;
}

function indexMain() {
    var log = setUpLog();

    // setup badge dropdown and default values.
    updateUrls();

    $("#provider_prefix_sel li").click(function(event){
      event.preventDefault();

      $("#provider_prefix-selected").text($(this).text());
      $("#provider_prefix").val($(this).attr("value"));
      updateRepoText();
      updateUrls();
    });

    $("#url-or-file-btn").find("a").click(function (evt) {
      evt.preventDefault();

      $("#url-or-file-selected").text($(this).text());
      updatePathText();
      updateUrls();
    });
    updatePathText();
    updateRepoText();

    $('#repository').on('keyup paste change', function(event) {updateUrls();});

    $('#ref').on('keyup paste change', function(event) {updateUrls();});

    $('#filepath').on('keyup paste change', function(event) {updateUrls();});

    $('#toggle-badge-snippet').on('click', function() {
        var badgeSnippets = $('#badge-snippets');
        if (badgeSnippets.hasClass('hidden')) {
            badgeSnippets.removeClass('hidden');
            $("#badge-snippet-caret").removeClass("glyphicon-triangle-right");
            $("#badge-snippet-caret").addClass("glyphicon-triangle-bottom");
        } else {
            badgeSnippets.addClass('hidden');
            $("#badge-snippet-caret").removeClass("glyphicon-triangle-bottom");
            $("#badge-snippet-caret").addClass("glyphicon-triangle-right");
        }

        return false;
    });

    $('#build-form').submit(function() {
        var formValues = getBuildFormValues();
        updateUrls(formValues);
        build(
          formValues.providerPrefix + '/' + formValues.repo + '/' + formValues.ref,
          log,
          formValues.path,
          formValues.pathType
        );
        return false;
    });
}

function loadingMain(providerSpec) {
  var log = setUpLog();
  // retrieve (encoded) filepath/urlpath from URL
  // URLSearchParams.get returns the decoded value,
  // that is good because it is the real value and '/'s will be trimmed in `launch`
  var params = new URL(location.href).searchParams;
  var pathType, path;
  path = params.get('urlpath');
  if (path) {
    pathType = 'url';
  } else {
    path = params.get('filepath');
    if (path) {
      pathType = 'file';
    }
  }
  build(providerSpec, log, path, pathType);
  return false;
}

// export entrypoints
window.loadingMain = loadingMain;
window.indexMain = indexMain;

// Load the clipboard after the page loads so it can find the buttons it needs
window.onload = function() {
  new Clipboard('.clipboard');
};
