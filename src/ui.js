// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';
import * as lobby from '../third_party/flackr.github.io/lobby/src/lobby.js';

let currentPage = undefined;
function $(selector) {
  return document.querySelector(selector);
}

function showPage(page) {
  if (currentPage) {
    document.body.classList.remove(currentPage);
    $('#' + currentPage).classList.remove('visible');
  }
  document.body.classList.add(page);
  $('#' + page).classList.add('visible');
  currentPage = page;
}

function log(evt, text, team) {
  let node = stampTemplate('.log-message', {
            sender: evt.sender,
            body: text,
            time: new Date(evt.origin_server_ts).toLocaleString(),
          });
  $('#game-log').appendChild(node);
  if (team) {
    node.classList.add(team);
  }
}

let currentGame;
function onhashchange() {
  // Stop updating if we switch away from the current game.
  if (document.body.classList.contains('auth')) {
    if (window.location.hash.startsWith('#game-')) {
      loadGame(window.location.hash.substring(6));
      return;
    }
    $('.mdl-layout-title').textContent = "Keywords";
    // If authenticated, default to the listing page if a valid page is not
    // specified.
    if (['#list', '#create'].indexOf(window.location.hash) == -1)
      window.location = '#list';
    showPage('page-' + window.location.hash.substring(1));
  } else {
    // Otherwise, show the login page.
    showPage('page-login');
  }
}

let service;
let client;
let listingRoom;

const DEFAULT_MATRIX_HOST = 'https://matrix.org';
const APP_NAME = 'com.github.flackr.keywords';
const MODE_KEY = APP_NAME + '.GameConfig';
const JOIN_EVENT = APP_NAME + '.JoinTeam';
const CLUE_EVENT = APP_NAME + '.Clue';
const GUESS_EVENT = APP_NAME + '.Guess';
const DONE_EVENT = APP_NAME + '.Done';
const CHAT_EVENT = APP_NAME + '.Chat';
const OPPOSITE_TEAM = {
  'blue': 'red',
  'red': 'blue',
};
const TEAMS = ['red', 'blue'];
const PHASE_CLUE = 'clue';
const PHASE_GUESS = 'guess';
const MODE_COOP = 'coop';
const MODE_VERSUS = 'versus';
const WORD_LISTS = [
  { name: 'easy',
    text: 'Easy words',
    file: 'data/easy.txt' },
  { name: 'medium',
    text: 'Medium words',
    file: 'data/medium.txt' },
  { name: 'hard',
    text: 'Hard words',
    file: 'data/hard.txt' },
  { name: 'locations',
    text: 'Locations',
    file: 'data/locations.txt' },
  { name: 'people',
    text: 'People',
    file: 'data/people.txt' },
];
let WORDS = [];
window.WORDS = WORDS;
let loaded = new Promise((resolve) => {
  let count = 0;
  for (let i = 0; i < WORD_LISTS.length; i++) {
    let name = WORD_LISTS[i].name;
    fetch(WORD_LISTS[i].file).then(function(response) {
      response.text().then(function(wordlist) {
        let words = wordlist.split('\n');
        // The final newline results in an additional blank word.
        words.pop();
        WORDS[name] = words;
        if (++count == WORD_LISTS.length)
          resolve();
      });
    });
  }
});

async function init() {
  showPage('loading');
  service = await lobby.createService({
    appName: APP_NAME,
    defaultHost: DEFAULT_MATRIX_HOST,
  });
  window.service = service;
  if (window.client = client = await service.reauthenticate()) {
    onlogin();
  } else {
    onhashchange();
  }
  $('#login-form').addEventListener('submit', function(evt) {
    evt.preventDefault();
    login();
  });
  $('#create-form').addEventListener('submit', function(evt) {
    evt.preventDefault();
    createRoom();
  })
  $('#done').addEventListener('click', donePress);
  $('#leave-button').addEventListener('click', leaveRoom);
  $('#logout').addEventListener('click', function(evt) {
    evt.preventDefault();
    client.logout();
    onlogout();
  });
  $('#game-chat').addEventListener('keypress', gameChatKeypress);
  for (let team of ['red', 'blue']) {
    $(`.${team} .join`).addEventListener('click', joinTeam.bind(null, team, false));
    $(`.${team} .join.clue`).addEventListener('click', joinTeam.bind(null, team, true));
  }
  $('#clue-id').addEventListener('keypress', clueTextboxKeypress);
  window.addEventListener('hashchange', onhashchange);
  for (let i = 0; i < WORD_LISTS.length; i++) {
    let el = stampTemplate('.wordlist', {
      'label': WORD_LISTS[i].text,
    });
    el.querySelector('input').setAttribute('id', 'wordlist-' + WORD_LISTS[i].name);
    el.querySelector('label.mdl-js-ripple-effect').setAttribute('for', 'wordlist-' + WORD_LISTS[i].name);
    $('#wordlists').appendChild(el);
  }
}

async function loginGuest() {
  try {
    if (!(client = await service.loginAsGuest(DEFAULT_MATRIX_HOST))) {
      console.error('Guest login failed');
      return;
    }
    onlogin();
  } catch (e) {
    showError(e);
  }
}

async function login() {
  console.log('attempting log in');
  try {
    if (!(client = await service.login($('#login-user-id').value, $('#login-password').value))) {
      console.error('Login failed');
      return;
    }
    onlogin();
  } catch (e) {
    showError(e);
  }
}

async function register() {
  console.log('attempting log in');
  try {
    if (!(client = await service.register($('#register-user-id').value, $('#register-password').value))) {
      console.error('Login failed');
      return;
    }
    onlogin();
  } catch (e) {
    showError(e);
  }
}

function createRoomElement(rooms, room_id) {
  let elem = stampTemplate('.room');
  let state = rooms[room_id];

  elem.querySelector('.title').textContent = state['m.room.topic'].topic;

  let playBtn = elem.querySelector('.join');
  playBtn.setAttribute('room-id', room_id);
  playBtn.addEventListener('click', function(evt) {
    evt.preventDefault();
    window.location = '#game-' + playBtn.getAttribute('room-id');
  });
  return elem;
}

function showError(e) {
  console.error(e);
  let data = {
    message: e.message,
    timeout: 8000,
  };
  if (data.message.length > 100)
    data.message = data.message.substring(0, 97) + '...';
  if (e.details && e.details.consent_uri) {
    data.actionHandler = function() {
      window.location = e.details.consent_uri;
    }
    data.actionText = 'Consent';
  }
  $('#snackbar').MaterialSnackbar.showSnackbar(data);
  // Rethrow the error if it's not a lobby error
  if (!(e instanceof lobby.MatrixError))
    throw e;
}

async function onlogin() {
  document.body.classList.add('auth');
  // Fire the hashchange handler to update the currently visible page.
  onhashchange();
  try {
    updateListings();
  } catch (e) {
    showError(e);
  }
}

async function updateListings(lobby) {
  // Clear all existing rooms.
  let container = $('#rooms');
  container.innerHTML = '';

  const EXTRA_HEIGHT = 200;
  let scroller = document.querySelector('.mdl-layout__content');

  let rooms = await client.joinedRoomStates();
  for (let room_id in rooms) {
    container.appendChild(createRoomElement(rooms, room_id));
  }
}

async function onlogout() {
  document.body.classList.remove('auth');
  showPage('page-login');
  $('#user').textContent = '';
}

function stampTemplate(template, details) {
  let instance = document.querySelector('#templates > ' + template).cloneNode(true);
  for (let field in details) {
    instance.querySelector('.' + field).textContent = details[field];
  }
  return instance;
}

function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

function generate(seed, mode, count, words) {
  let wordlist = JSON.parse(JSON.stringify(words));
  let prng = mulberry32(seed);
  let tiles = [];
  let puzzle = {
    first: '',
    tiles: [],
  };
  let generated = 0;

  function genTile() {
    if (tiles.length == 0)
      throw Error('No more blank tiles');
    let pos = Math.floor(prng() * tiles.length);
    return tiles.splice(pos, 1)[0];
  }

  for (let i = 0; i < count; i++) {
    let wordIndex = Math.floor(prng() * wordlist.length);
    let word = wordlist[wordIndex];
    let current = {word};
    wordlist.splice(wordIndex, 1);
    tiles.push(current);
    puzzle.tiles.push(current);
  }

  if (mode != MODE_VERSUS) {
    var clues = [
      [1, 'death', 'green'],
      [5, '', 'green'],
      [3, 'green', 'green'],
      [5, 'green', ''],
      [1, 'green', 'death'],
      [1, '', 'death'],
      [1, 'death', 'death'],
      [1, 'death', ''],
    ];
    for (var i = 0; i < clues.length; i++) {
      for (var j = 0; j < clues[i][0]; j++) {
        var tile = genTile();
        tile['red'] = clues[i][1]
        tile['blue'] = clues[i][2];
      }
    }
    // TODO: Replace with -1 special first team which selects better clue.
    puzzle.first = Math.floor(prng() * TEAMS.length);
  } else {
    let player = Math.floor(prng() * TEAMS.length);
    puzzle.first = player;
    var positions = 9 + 8;
    for (var i = 0; i < positions; i++) {
      genTile()['team'] = TEAMS[player];
      player = (player + 1) % TEAMS.length;
    }
    genTile()['team'] = 'death';
  }
  return puzzle;
}

async function loadGame(room_id) {
  let players = {};
  $('#game-log').innerHTML = '';
  showPage('page-game');
  let game = await client.join(room_id);
  let puzzle;
  let team;
  let turn = 0;
  let phase = PHASE_CLUE;
  let mode;
  let cluegiver = false;
  let allowClueEntry = false;
  let allowGuessing = false;
  currentGame = game;

  function updateTurn() {
    let current = TEAMS[turn];
    allowClueEntry = false;
    allowGuessing = false;
    if (!team)
      return;
    let clueEntry = $('.entry > .mdl-textfield');
    if (current == team) {
      if (phase == PHASE_CLUE) {
        if (cluegiver) {
          $('.mdl-layout-title').textContent = "Your turn! Provide a clue";
          allowClueEntry = true;
        } else {
          $('.mdl-layout-title').textContent = "Waiting for clue";
        }
      } else { // phase == PHASE_GUESS
        if (cluegiver && mode == MODE_VERSUS) {
          $('.mdl-layout-title').textContent = "Waiting for team's guess";
        } else {
          $('.mdl-layout-title').textContent = "Take your guesses";
          allowGuessing = true;
        }
      }
    } else {
      if (mode == MODE_COOP)
        $('.mdl-layout-title').textContent = "Waiting for next clue";
      else
        $('.mdl-layout-title').textContent = "Waiting for other team";
    }
    $('.entry > .mdl-textfield').style.display = allowClueEntry ? '' : 'none';
    if (allowGuessing)
      $('.playing').classList.add('guess');
    else
      $('.playing').classList.remove('guess');
  }

  function doneGuessing() {
    if (mode == MODE_VERSUS)
      turn = (turn + 1) % TEAMS.length;
    phase = PHASE_CLUE;
    updateTurn();
  }

  function guessTile(word) {
    if (!currentGame || !allowGuessing)
      return;
    currentGame.sendEvent(GUESS_EVENT, {
      guess: word,
    });
  }

  while (true) {
    let events = await game.fetchEvents();
    // TODO: Also stop updating if we're not currently viewing the game.
    if (!game == currentGame)
      return;
    let wasScolledToBottom = $('#game-log').scrollTop >= $('#game-log').scrollHeight - $('#game-log').clientHeight - 15;
    for (let evt of events) {
      if (evt.type == MODE_KEY) {
        mode = evt.content.mode;
        $('#page-game').setAttribute('mode', mode);
        $('#page-game').setAttribute('stage', 'setup');
        await loaded;
        let dictionary = [];
        for (let i = 0; i < evt.content.wordlists.length; i++) {
          dictionary = dictionary.concat(WORDS[evt.content.wordlists[i]]);
        }
        puzzle = generate(evt.origin_server_ts, mode, 25, dictionary);
        turn = puzzle.first;
        $('.board').innerHTML = '';
        for (let i = 0; i < puzzle.tiles.length; i++) {
          puzzle.tiles[i].elem = stampTemplate('.board-word', {word: puzzle.tiles[i].word});
          componentHandler.upgradeElement(puzzle.tiles[i].elem);
          $('.board').appendChild(puzzle.tiles[i].elem);
        }
      } else if (evt.type == JOIN_EVENT && !players[evt.sender]) {
        log(evt, 'joined ' + evt.content.team + (evt.content.clue ? ' as a clue giver' : ''), evt.content.team);
        let clue = evt.content.clue ? 'clue' : 'players';
        let roster = $(`.${evt.content.team} .${clue} .list`);
        if (!players[evt.sender]) {
          players[evt.sender] = {
            elem: stampTemplate('.player-token', {sender: evt.sender}),
            team: '',
          }
        }
        players[evt.sender].team = evt.content.team;
        players[evt.sender].clue = evt.content.clue;
        roster.appendChild(players[evt.sender].elem);
        if (evt.sender == client.user_id) {
          team = evt.content.team;
          cluegiver = mode == MODE_COOP || evt.content.clue;
          $('#page-game').setAttribute('stage', 'playing');
          // transition to joined state.
          for (let i = 0; i < puzzle.tiles.length; i++) {
            let tile = puzzle.tiles[i].elem;
            if (mode == MODE_VERSUS && cluegiver && puzzle.tiles[i].team)
              tile.classList.add(puzzle.tiles[i].team);
            else if (mode == MODE_COOP && puzzle.tiles[i][team])
              tile.classList.add(puzzle.tiles[i][team]);
            // Disable guessed tiles.
            if (tile.classList.contains('guessed')) {
              tile.setAttribute('disabled', true);
              let result = puzzle.tiles[i].team;
              tile.classList.add('reveal-' + result || 'none');
            }
            if (tile.classList.contains('guessed-' + team))
              tile.setAttribute('disabled', true);
            if (tile.classList.contains('guessed-' + OPPOSITE_TEAM[team])) {
              let result = puzzle.tiles[i][OPPOSITE_TEAM[team]];
              if (!result)
                tile.classList.add('reveal-none');
            }
            tile.addEventListener('click', guessTile.bind(null, puzzle.tiles[i].word));
          }
          updateTurn();
        }
      } else if (evt.type == CLUE_EVENT && players[evt.sender].team == TEAMS[turn]) {
        log(evt, 'clued ' + evt.content.clue, players[evt.sender].team);
        $('#clue-display').textContent = evt.content.clue;
        if (mode == MODE_COOP)
          turn = (turn + 1) % TEAMS.length;
        phase = PHASE_GUESS;
        updateTurn();
      } else if (evt.type == GUESS_EVENT && players[evt.sender].team == TEAMS[turn] && !players[evt.sender].clue) {
        log(evt, 'guessed ' + evt.content.guess);
        for (let i = 0; i < puzzle.tiles.length; i++) {
          if (puzzle.tiles[i].word == evt.content.guess) {
            let guessTeam = OPPOSITE_TEAM[players[evt.sender].team];
            let result = mode == MODE_COOP ? puzzle.tiles[i][guessTeam] : puzzle.tiles[i].team;
            let tile = puzzle.tiles[i].elem;
            if (result || team == players[evt.sender].team)
              tile.setAttribute('disabled', true);
            if (mode == MODE_VERSUS)
              tile.classList.add('guessed');
            else
              tile.classList.add('guessed-' + players[evt.sender].team);
            if (result || mode == MODE_VERSUS ||
                (team && team != players[evt.sender].team)) {
              tile.classList.add('reveal-' + (result || 'none'));
            }
            let correct = (mode == MODE_COOP && result == 'green') ||
                (mode == MODE_VERSUS && result == players[evt.sender].team);
            if (!correct)
              doneGuessing();
            break;
          }
        }
      } else if (evt.type == DONE_EVENT && players[evt.sender].team == TEAMS[turn] && !players[evt.sender].clue) {
        doneGuessing();
      } else if (evt.type == CHAT_EVENT) {
        let showMessage = false;
        let sender = players[evt.sender];
        if (mode == MODE_VERSUS) {
          if (sender) {
            if (sender.clue) {
              // Messages from cluegivers only show to other cluegivers on the same team.
              showMessage = sender.team == team && cluegiver;
            } else {
              // Messages from other players show to everyone.
              showMessage = true;
            }
          }
        } else { // MODE_COOP
          // Messages in coop only show to same team.
          showMessage = sender && sender.team == team;
        }
        // Only see chat from your team.
        if (showMessage) {
          let div = stampTemplate('.chat-message', {
            sender: evt.sender,
            body: evt.content.body,
            time: new Date(evt.origin_server_ts).toLocaleString(),
          });
          if (sender)
            div.querySelector('.sender').classList.add(sender.team);
          $('#game-log').appendChild(div);
        }
      }
    }
    if (wasScolledToBottom)
      $('#game-log').scrollTop = $('#game-log').scrollHeight - $('#game-log').clientHeight;
  }
}

async function joinTeam(team, clue) {
  if (!currentGame)
    return;
  currentGame.sendEvent(JOIN_EVENT, {
    team, clue,
  })
}

function gameChatKeypress(evt) {
  if (!currentGame)
    return;
  if (evt.keyCode == 13) {
    let msg = evt.target.value;
    evt.target.value = '';
    currentGame.sendEvent(CHAT_EVENT, {
      msgtype: 'm.text',
      body: msg,
    });
    evt.target.parentElement.classList.remove('is-dirty');
  }
}

function clueTextboxKeypress(evt) {
  if (!currentGame)
    return;
  if (evt.keyCode == 13) {
    let clue = evt.target.value;
    evt.target.value = '';
    currentGame.sendEvent(CLUE_EVENT, {
      clue,
    });
    evt.target.parentElement.classList.remove('is-dirty');
  }
}

function donePress() {
  if (!currentGame)
    return;
  currentGame.sendEvent(DONE_EVENT, {});  
}

async function leaveRoom() {
  if (!currentGame)
    return;
  window.location.hash = 'list';
  await currentGame.leave();
  updateListings();
}

async function createRoom() {
  let mode = $('#create-form')['mode'].value;
  let wordlists = [];
  for (let i = 0; i < WORD_LISTS.length; i++) {
    if ($('#wordlist-' + WORD_LISTS[i].name).checked)
      wordlists.push(WORD_LISTS[i].name);
  }
  try {
    let topic = mode == MODE_VERSUS ? 'Versus game' : 'Coop game';
    let room_id = await client.create({
      topic,
      initial_state: [{
        type: MODE_KEY,
        content: {mode, wordlists}}]});
    window.location = '#game-' + room_id;
  } catch (e) {
    showError(e);
  }
}

document.addEventListener('DOMContentLoaded', init);
