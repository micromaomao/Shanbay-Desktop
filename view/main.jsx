const nodeRequire = window.require
const ReactDOM = require('react-dom')
const React = require('react')
const electron = nodeRequire('electron')
const win = electron.remote.getCurrentWindow()
let ipc

// For those of you who don't know... There is some country blocking it.
let googleAvailable = false
window.testGoogle = testGoogle

let audios = []
function playAudio (url, onComplete) {
  let audio = new window.Audio(url)
  audio.play()
  let idx = audios.push(audio) - 1
  audio.addEventListener('ended', evt => {
    audios[idx] = null
    if (!audios.find(x => x !== null)) {
      audios = []
    }
    if (onComplete) {
      onComplete()
    }
  })
}

let lookupWord = (function () {
  let reqId = 1
  return word => {
    return new Promise((resolve, reject) => {
      ipc.once(`lookup:${reqId}`, (evt, arg) => {
        if (arg.err) {
          reject(arg.err)
        } else {
          resolve(arg)
        }
      })
      ipc.send('lookup', {reqId: reqId, word: word})
      reqId++
    })
  }
})()

class StatBar extends React.Component {
  render () {
    let {pass, fail, review, pending, total} = this.props
    function r (n, v) {
      if (!Number.isFinite(v)) {
        return null
      }
      if (v === 0) {
        return null
      }
      return (
        <div className={n} style={{width: (v / total * 100) + '%'}}>
          {v}
        </div>)
    }
    return (
      <div className='statbar'>
        {r('pass', pass)}
        {r('review', review)}
        {r('pending', pending)}
        {r('fail', fail)}
      </div>
    )
  }
}

class MainUI extends React.Component {
  constructor () {
    super()
    this.state = {
      user: null,
      stats: null,
      currentWord: null,
      welcome: true,
      reviewError: null,
      submitQueue: null,
      current: null,
      end: false,
      google: googleAvailable
    }
    ipc.on('user', (event, arg) => {
      this.setState({user: {
        nickname: arg.nickname,
        username: arg.username,
        id: arg.id,
        avatar: arg.avatar
      }})
      if (!arg.avatar) {
        ipc.send('avatar')
      }
    })
    ipc.on('avatar', (event, arg) => {
      if (arg.err) {
        ipc.send('avatar')
        return
      }
      this.setState({user: {
        avatar: arg.avatar
      }})
    })
    ipc.on('todayStats', (event, arg) => {
      if (arg.err) {
        ipc.send('todayStats')
        return
      }
      this.setState({stats: {
        total: arg['num_today'],
        fail: arg['num_failed'],
        pending: arg['num_left'] - arg['num_failed'] - arg['num_reviewed'],
        review: arg['num_reviewed'],
        pass: arg['num_passed']
      }})
      if (arg['num_left'] === 0) {
        this.setState({
          end: true
        })
      }
    })
    ipc.on('review', (event, arg) => {
      if (arg !== null && arg.err) {
        ipc.send('review', {})
        this.setState({welcome: false, currentWord: null,
          reviewError: arg.err.toString(), current: null})
      } else if (arg !== null) {
        this.setState({welcome: false, currentWord: arg, reviewError: null})
        this.startWord()
      } else {
        this.setState({end: true})
      }
    })
    ipc.on('submitQueue', (event, arg) => {
      this.setState({submitQueue: arg})
    })
    ipc.on('quit', (event, arg) => {
      this.setState({end: true, quit: true})
    })
    this.handleUserPage = this.handleUserPage.bind(this)
    this.handleKeyPress = this.handleKeyPress.bind(this)
    this.handleSpellCheck = this.handleSpellCheck.bind(this)
    this.handleSpellSuccess = this.handleSpellSuccess.bind(this)
    this.handleSynCheck = this.handleSynCheck.bind(this)
    this.handleLogout = this.handleLogout.bind(this)
  }
  nextWord (result) {
    // Submit the result of this word and fetch next word.
    let prevResults = null
    if (result && this.state.currentWord) {
      let word = this.state.currentWord
      prevResults = {}
      let sub = result
      if (sub === 'pass' && word.reviewStatus === 'fresh') {
        sub = 'master'
      }
      let time = (Date.now() - this.state.current.startTime) / 1000
      prevResults[this.state.currentWord.submitId] = {result: sub, second: Math.round(time)}
    }
    ipc.send('review', {prevResults: prevResults})
    this.setState({welcome: false, currentWord: null, reviewError: null,
    current: null})
  }
  handleLogout () {
    ipc.send('logout')
  }
  componentDidMount () {
    ipc.send('user')
    ipc.send('todayStats')
    window.addEventListener('keydown', this.handleKeyPress)
  }
  startWord () {
    // The word data has already been put in state. Start this word.
    let word = this.state.currentWord
    if (word === null) {
      console.error(new Error("?! (Unexpected 'startWord')"))
      return
    }
    let audioNames = Object.keys(word.audios || {})
    function wordAudio (i) {
      if (i >= audioNames.length) {
        return
      }
      let current = word.audios[audioNames[i]]
      playAudio(current, () => setTimeout(() => wordAudio(i + 1), 500))
    }
    wordAudio(0)
    let syllhp = word.wordsapi ? word.wordsapi.syllables : null
    let wordWithHyp = word.word
    if (syllhp && syllhp.count > 0) {
      wordWithHyp = syllhp.list.join('‧')
    }
    let spelling = this.buildSpell(wordWithHyp)
    this.setState({current: {
      displayWord: wordWithHyp,
      state: 'spelling',
      spelling,
      spellIndex: 0,
      audio: audioNames[0],
      revealSpell: false,
      startTime: Date.now()
    }})
  }
  buildSpell (wordWithHyp) {
    return wordWithHyp.split('').map(x => {
      let spellable = x.match(/[a-z]/)
      return {
        char: x,
        show: !spellable,
        spellable: spellable,
        wrong: false
      }
    })
  }
  handleKeyPress (event) {
    if (event.key === 'F12' || event.keyCode === 123) {
      win.openDevTools()
      console.log('Right.. This is built with Web technology :D')
      return
    }
    if (this.state.welcome) {
      this.nextWord()
      return
    }
    if (this.state.currentWord && this.state.current) {
      let current = this.state.current
      let word = this.state.currentWord
      if (current.state === 'spelling') {
        let letter = event.key || String.fromCharCode(event.keyCode)
        if (current.revealSpell) {
          this.setState({current: Object.assign({}, current, {
            revealSpell: false
          })})
        }
        if (!letter.match(/^[a-zA-Z]$/g)) {
          if (event.key === 'Backspace' || event.keyCode === 8) {
            event.preventDefault()
            this.handleSpellCheck(null)
            return
          }
          if (event.key === '9' || event.keyCode === 57) {
            // Reveal the word and clear user's input.
            event.preventDefault()
            this.setState({current: Object.assign({}, current, {
              revealSpell: true
            })})
            this.handleSpellCheck(null)
            return
          }
        } else {
          letter = letter.toLowerCase()
          event.preventDefault()
          this.handleSpellCheck(letter)
          return
        }
      }
      if (current.state === 'ask') {
        if (current.askSyn) {
          // Check syn input in real time.
          if (event.key === 'Enter' || event.keyCode === 13) {
            event.preventDefault()
            this.handleSynCheck(true)
            return
          } else {
            setTimeout(() => this.handleSynCheck(false), 1)
          }
        } else {
          if (event.key === 'Enter' || event.keyCode === 13) {
            event.preventDefault()
            current = Object.assign(current, {
              inputedSyn: null,
              markOK: true
            })
            this.setState({current: current})
            this.inShow()
            return
          }
          if (event.key === ' ' || event.keyCode === 32) {
            event.preventDefault()
            current = Object.assign(current, {
              inputedSyn: null,
              markOK: false
            })
            this.setState({current: current})
            this.inTest()
            return
          }
        }
      }
      if (current.state === 'test') {
        if (event.key === '1' || event.keyCode === 49) {
          // The user had remembered the word.
          event.preventDefault()
          this.inShow()
          return
        }
        if (event.key === ' ' || event.keyCode === 32) {
          // The user still has no idea.
          event.preventDefault()
          this.nextTestSlide()
          return
        }
      }
      if (current.state === 'show') {
        if (event.key.toLowerCase() === ' ' || event.keyCode === 32) {
          // Final page over, show next word.
          event.preventDefault()
          this.finishWord()
          return
        }
        if (event.key === '1' || event.keyCode === 49) {
          // User requested to mark the word as forget ( although they get the syn test correct. )
          event.preventDefault()
          current = Object.assign(current, {
            markOK: false
          })
          this.setState({current: current})
          return
        }
      }
      if (event.key === '0' || event.keyCode === 48) {
        event.preventDefault()
        playAudio(word.audios[current.audio])
        return
      }
    }
  }
  finishWord () {
    // Finish this word and submit the result based on current.markOK .
    let current = this.state.current
    let currentWord = this.state.currentWord
    if (!currentWord || !current) {
      return
    }
    let ok = current.markOK || false
    this.nextWord(ok ? 'pass' : 'forget')
  }
  handleSpellCheck (letter) {
    // User pressed a single letter.
    if (this.state.currentWord && this.state.current) {
      let current = this.state.current
      if (current.state === 'spelling') {
        if (letter === null) {
          // Restart
          let spelling = this.buildSpell(current.displayWord)
          this.setState({current: Object.assign({}, current, {
            state: 'spelling',
            spelling: spelling,
            spellIndex: 0
          })})
        } else {
          let spelling = current.spelling
          let index = current.spellIndex
          let currentSpell = spelling[index]
          if (letter.toLowerCase() === currentSpell.char.toLowerCase()) {
            currentSpell = Object.assign({}, currentSpell, {
              show: true,
              wrong: false
            })
            spelling[index] = currentSpell
            index++
            while (spelling[index] && !spelling[index].spellable) {
              index++
            }
          } else {
            // User get it wrong. If this is the second time, show the letter.
            currentSpell = Object.assign({}, currentSpell, {
              show: currentSpell.wrong,
              wrong: true
            })
            spelling[index] = currentSpell
          }
          if (index < spelling.length) {
            this.setState({current: Object.assign({}, current, {
              state: 'spelling',
              spelling: spelling,
              spellIndex: index
            })})
          } else {
            this.handleSpellSuccess()
          }
        }
      }
    }
  }
  handleSpellSuccess () {
    // Ask (Test) the user if they know the word.
    let currentWord = this.state.currentWord
    let current = this.state.current
    if (!currentWord || !current) {
      return
    }
    let allsyns = this.getAllSyns()
    let hintChosen = null
    let hintsAvail = []
    function chooseRandom (x) {
      if (x.length === 0) {
        return null
      }
      return x[Math.floor(Math.random() * x.length)]
    }
    if (currentWord.reviewStatus === 'failed') {
      if (allsyns.length > 0) {
        hintsAvail.push('~= ' + chooseRandom(allsyns))
      }
      if (currentWord.wordsapi) {
        let wapis = currentWord.wordsapi.results
        let typeOfChoosen = 0
        if (wapis.length > 0) {
          wapis.forEach(x => {
            if (x.typeOf && typeOfChoosen <= 2) {
              hintsAvail.push('Typeof ' + chooseRandom(x.typeOf))
              typeOfChoosen += 1
            }
            if (x.verbGroup) {
              hintsAvail.push('Typeof ' + chooseRandom(x.verbGroup))
            }
            if (x.hasTypes) {
              hintsAvail.push('PrototypeOf ' + chooseRandom(x.hasTypes))
            }
            if (x.similarTo) {
              hintsAvail.push('SimilarTo ' + chooseRandom(x.similarTo))
            }
            if (x.antonyms) {
              hintsAvail.push('!= ' + chooseRandom(x.antonyms))
            }
            if (x.attribute) {
              hintsAvail.push('ValueOf ' + chooseRandom(x.attribute))
            }
            if (x.also) {
              hintsAvail.push('Also ' + chooseRandom(x.also))
            }
            if (x.substanceOf) {
              hintsAvail.push('Extends ' + chooseRandom(x.substanceOf))
            }
            if (x.partOf) {
              hintsAvail.push('PartOf ' + chooseRandom(x.partOf))
            }
          })
        }
      }
      if (hintsAvail.length > 0) {
        let a = chooseRandom(hintsAvail)
        let b = chooseRandom(hintsAvail)
        hintChosen = a + (a === b ? '' : ' & ' + b)
      }
    }
    current = Object.assign(current, {
      state: 'ask',
      syns: allsyns,
      askSyn: allsyns.length > 0,
      askResult: null,
      hintChosen
    })
    this.setState({current: current})
  }
  handleUserPage () {
    let link = 'https://www.shanbay.com/bdc/review/progress/' + this.state.user.id
    electron.shell.openExternal(link)
  }
  getPron () {
    // Prase and get IPA from Shanbay or Wordsapi. Return a single string like "uk: xxx, us: xxx".
    let currentWord = this.state.currentWord
    if (!currentWord) {
      return
    }
    let prons
    if (currentWord.pron && Object.keys(currentWord.pron).length > 0) {
      let _names = Object.keys(currentWord.pron)
      let names = []
      prons = currentWord.pron
      _names.forEach(name => {
        if (prons[name].length > 0) {
          names.push(name)
        }
      })
      if (names.length === 0) {
        currentWord.pron = null
        return this.getPron()
      }
      prons = names.map(name => name + ': ' + prons[name])
        .join(', ')
      return prons
    } else if (currentWord.wordsapi && currentWord.wordsapi.pronunciation) {
      let wapiProns = currentWord.wordsapi.pronunciation
      if (wapiProns && Object.keys(wapiProns)) {
        let names = Object.keys(wapiProns)
        let prons = names.map(name => (name === 'all' ? '' : name + ': ') + wapiProns[name])
          .join(', ')
        return prons
      }
      return null
    }
    return null
  }
  getAllSyns () {
    // Prase and get all syns from wordsapi and thesaurus.com
    let currentWord = this.state.currentWord
    if (!currentWord) {
      return
    }
    if (!currentWord.wordsapi) {
      return []
    }
    let wapi = currentWord.wordsapi
    if (!wapi.results || wapi.results.length === 0) {
      return []
    }
    let rets = []
    wapi.results.forEach(result => {
      let syns = result.synonyms
      if (!syns || syns.length === 0) {
        return
      }
      // Array.prototype.push.apply(rets, syns)
      syns.forEach(syn => {
        let found = rets.find(x => x === syn)
        if (!found) {
          rets.push(syn)
        }
      })
    })
    let therSyns = currentWord.therSyns
    if (therSyns) {
      therSyns.forEach(syn => {
        let found = rets.find(x => x === syn)
        if (!found) {
          rets.push(syn)
        }
      })
    }
    return rets
  }
  handleSynCheck (showError) {
    let currentWord = this.state.currentWord
    let current = this.state.current
    if (!currentWord || !current) {
      return
    }
    let allsyns = current.syns
    let inputedSyn = this._askSynInput.value.toLowerCase()
    let found = allsyns.find(x => x.toLowerCase() === inputedSyn)
    if (found) {
      // User get it right.
      current = Object.assign(current, {
        inputedSyn: inputedSyn,
        markOK: true,
        hintChosen: null
      })
      this.setState({current: current})
      this.inShow()
    } else if (showError) {
      // User get it wrong.
      let oldInputed = current.inputedSyn
      if (inputedSyn === '') {
        // User gave up
        current = Object.assign(current, {
          inputedSyn: null,
          markOK: false,
          hintChosen: null
        })
        this.setState({current: current})
        this.inTest()
      } else if (inputedSyn !== oldInputed) {
        // User get it wrong but think it's right.
        current = Object.assign(current, {
          synError: true,
          inputedSyn: inputedSyn
        })
        this.setState({current: current})
      } else {
        // User still think it's right.
        current = Object.assign(current, {
          inputedSyn: null,
          markOK: true,
          hintChosen: null
        })
        this.setState({current: current})
        this.inShow()
      }
    } else {
      // User's inputing it's answer.
      current = Object.assign(current, {
        synError: false
      })
      this.setState({current: current})
    }
  }
  inTest () {
    let currentWord = this.state.currentWord
    let current = this.state.current
    if (!currentWord || !current) {
      return
    }
    current = Object.assign(current, {
      state: 'test',
      slide: null,
      markOK: false
    })
    this.setState({current: current})
    this.nextTestSlide()
  }
  inShow () {
    let currentWord = this.state.currentWord
    let current = this.state.current
    if (!currentWord || !current) {
      return
    }
    current = Object.assign(current, {
      state: 'show'
    })
    this.setState({current: current})
  }
  nextTestSlide () {
    let currentWord = this.state.currentWord
    let current = this.state.current
    if (!currentWord || !current) {
      return
    }
    let currentSlide = current.slide
    switch (currentSlide) {
      case null:
        let syns = current.syns
        current = Object.assign(current, {
          state: 'test',
          slide: 'syn'
        })
        this.setState({current: current})
        if (syns.length === 0) {
          return this.nextTestSlide()
        }
        break
      case 'syn':
        let examples = currentWord.examples
        current = Object.assign(current, {
          state: 'test',
          slide: 'sentence'
        })
        this.setState({current: current})
        if (examples.length === 0) {
          return this.nextTestSlide()
        }
        break
      case 'sentence':
        current = Object.assign(current, {
          state: 'test',
          slide: 'image'
        })
        this.setState({current: current})
        break
      case 'image':
        this.inShow()
        break
    }
  }

  render () {
    let userStat = null
    let statBar = null
    let avatar = null
    let logoutBtn = null
    if (this.state.user != null) {
      if (this.state.user.avatar) {
        avatar = (<img src={this.state.user.avatar} onClick={this.handleUserPage} className='avatar' />)
      }
      if (!this.state.quit) {
        logoutBtn = (
          <button className='logout' onClick={this.handleLogout}>
            Logout
          </button>
        )
      }
      userStat = (
        <div className='user'>
          {avatar}
          <span className='username' onClick={this.handleUserPage}>{this.state.user.nickname.toString()}</span>
          {logoutBtn}
        </div>
      )
    } else {
      userStat = (
        <div className='user'>
          Loading user data...
        </div>
      )
    }
    if (this.state.stats) {
      let stats = this.state.stats
      statBar = (
        <StatBar
          fail={stats.fail}
          review={stats.review}
          pass={stats.pass}
          total={stats.total}
          pending={stats.pending} />
      )
    } else {
      statBar = (
        <StatBar />
      )
    }
    let word = null
    let cw = this.state.currentWord
    let imageWebview = null
    let sq = this.state.submitQueue
    if (this.state.welcome || this.state.end) {
      let stats = this.state.stats
      let statDiv = null
      if (!this.state.quit && stats) {
        statDiv = (
          <div className='stat'>
            {stats.pass + ' / ' + stats.total + ' words passed today.'}
          </div>
        )
      }
      if (stats != null) {
        word = (
          <div className='mid'>
            {statDiv}
            <div className='press'>
              {this.state.end
                 ? (
                 this.state.quit
                   ? 'Saving your work...'
                   : "You finished all today's words. Now check-in using web."
                 )
                 : 'Only keyboard needed. Press any key to start...'}
            </div>
          </div>
        )
      } else {
        word = (
          <div className='mid'>
            <div className='loadingAnimation' />
            {"Loading today's task..."}
          </div>
        )
      }
    } else if (cw == null) {
      let err = null
      if (this.state.reviewError) {
        err = (
          <div className='err'>
            {this.state.reviewError}
          </div>
        )
      } else if (sq && sq.prevErr) {
        err = (
          <div className='err'>
            {sq.prevErr}
          </div>
        )
      }
      word = (
        <div className='mid'>
          <div className='loadingAnimation' />
          <div className='press'>
            {err === null ? 'Just a moment... ( Connection sucks )'
               : 'Oops... Check your network.'}
          </div>
          {err}
        </div>
      )
    } else {
      let current = this.state.current
      let currentWord = this.state.currentWord
      let speller = null
      let ask = null
      let desc = null
      let synSlide = null
      let defs = []
      let exampleSentences = null
      let bottomDesc = null
      let firstHint = null
      if (!current) {
        word = (
          <div className='word'>
          </div>
        )
      } else {
        switch (current.state) {
          case 'spelling':
            speller = (<WordSpeller spelling={current.spelling} reveal={current.revealSpell} />)
            break
          case 'ask':
            if (current.hintChosen) {
              firstHint = (
                <div className='firstHint'>
                  <div className='hint'>
                    {current.hintChosen}
                  </div>
                  {current.askSyn ? "If you still don't know the meaning, just press Enter." : null}
                </div>
              )
            }
            if (current.askSyn) {
              let synError = null
              if (current.synError) {
                synError = (
                  <div className='error'>
                    {"Oh... Try again or leave empty."}
                    {" If you think this is right, press Enter again."}
                  </div>
                )
              }
              ask = (
                <div className='ask askSyn'>
                  {firstHint}
                  <div className='desc'>
                    {"Type a synonym of this word"}
                    {" ( or leave empty if you don't know the meaning"}
                    {" of this word ) and press Enter."}
                    {" If you do know the meaning but can't think of a"}
                    {" synonym, type anything and press two Enter."}
                  </div>
                  <input
                    type='text'
                    className='askSynInput'
                    ref={f => (this._askSynInput = f)}
                    autoFocus
                    onBlur={evt => {
                      evt.preventDefault()
                      this._askSynInput &&
                      ReactDOM.findDOMNode(this._askSynInput)
                        .focus()
                    }} />
                  {synError}
                </div>
              )
            } else {
              ask = (
                <div className='ask'>
                  {firstHint}
                  {"Know the meaning of this word?"}
                  <div className='desc'>
                    {"Press Enter means know, space means don't."}
                  </div>
                </div>
              )
            }
            break
          case 'test':
            desc = (
              <div className='desc'>
                {"See these information, if you suddenly know"}
                {" the meaning for this word, press 1, else press space."}
              </div>
            )
            switch (current.slide) {
              case 'syn':
                synSlide = (
                  <SynTestSlide syns={current.syns} bold={null} />
                )
                break
              case 'sentence':
                exampleSentences = (
                  <ExampleSentences examples={currentWord.examples} hintMode />
                )
                break
              case 'image':
                imageWebview = (
                  <div className='cweb'>
                    <WordImageSearchView word={currentWord.word} />
                  </div>
                )
                break
            }
            break
          case 'show':
            synSlide = (
              <SynTestSlide syns={current.syns} bold={current.inputedSyn} />
            )
            let defIndex = 0
            let addDef = (def, from) => {
              defs.push(<div key={defIndex} className={'def ' + from}>
                {<WordDictPrompt text={def} />}
              </div>)
              defIndex++
            }
            let collins = currentWord.collinsDefs
            if (collins) {
              collins.forEach(x => addDef(x, 'collins'))
            }
            let shanbay = currentWord.def
            if (shanbay) {
              Object.keys(shanbay).forEach(k => {
                let p = shanbay[k]
                p.forEach(x => addDef(k + '. ' + x, 'shanbay'))
              })
            }
            let cndef = currentWord.cndef
            if (cndef) {
              addDef(cndef, 'cn')
            }
            exampleSentences = (<ExampleSentences examples={currentWord.examples} />)
            let undoable = current.markOK
            bottomDesc = (
              <div className='desc'>
                {'Press space to show next word.'}
                {undoable ? ' Press 1 to undo ( to see this word more times ).' : null}
              </div>
            )
            break
        }
        let pr = this.getPron()
        let pron = null
        if (pr) {
          pron = (<div className='pron'>
            {pr}
          </div>)
        }
        word = (
          <div className='word'>
            {pron}
            {speller || current.displayWord}
            {ask}
            {desc}
            {synSlide}
            {defs}
            {exampleSentences}
            {bottomDesc}
          </div>
        )
      }
    }
    let queueStat = null
    if (sq) {
      if (sq.length === 0 && sq.prevErr === null) {
        queueStat = null
      } else {
        if (sq.prevErr === null) {
          queueStat = (<div className='queue progress'>
            Submiting {sq.length} results...
          </div>)
        } else {
          let count = (sq.length <= 1 ? null : ' (' + sq.length + ')')
          queueStat = (<div className='queue error'>
            Error: {sq.prevErr} {count}
          </div>)
        }
      }
    }
    let googleAvailability = null
    if (!this.state.google) {
      googleAvailability = (<div className='nogoogle' title="instead of Google because we can't reach it.">
        Using Bing.
      </div>)
    }
    return (
      <div className='mainUI'>
        <div className={'mid' + (imageWebview ? ' flex' : '')}>
          {word}
          {imageWebview}
        </div>
        <div className='stat'>
          <div className='left'>
            {statBar}
          </div>
          <div className='right'>
            {googleAvailability}
            {queueStat}
            {userStat}
          </div>
        </div>
      </div>
    )
  }
}

class WordSpeller extends React.Component {
  constructor () {
    super()
    this.state = {}
  }
  render () {
    let spells = []
    let table = this.props.spelling
    let index = 0
    table.forEach(ch => {
      let className = 'letter'
      if (ch.show || this.props.reveal) {
        className += ' show'
      } else if (ch.spellable) {
        className += ' hide'
      } else {
        className += ' fade'
      }
      if (ch.wrong) {
        className += ' wrong'
      }
      spells.push(
        <div className={className} key={index}>
          {ch.char}
        </div>
      )
      index++
    })
    return (
      <div className='wordSpeller'>
        {spells}
      </div>
    )
  }
}

class SynTestSlide extends React.Component {
  constructor () {
    super()
    this.state = {}
  }
  render () {
    let syns = this.props.syns
    let index = 0
    return (
      <div className='synSlide'>
        {syns.map(syn => {
          if (index > 9) return null
          let bold = syn === this.props.bold
          let c = index
          index++
          return (<div key={c} className={'syn' + (bold ? ' bold' : '')}>
            <WordDictPrompt text={syn} />
          </div>)
        })}
      </div>
    )
  }
}

class ExampleSentences extends React.Component {
  constructor () {
    super()
    this.state = {
      maxIndex: 4
    }
    this.step = 5
    this.handleMore = this.handleMore.bind(this)
  }
  handleMore () {
    this.setState({
      maxIndex: this.state.maxIndex + this.step
    })
  }
  render () {
    if (this.props.examples.length === 0) {
      return null
    }
    let index = 0
    let somethingLeft = false
    let sentences
    if (!this.props.hintMode) {
      sentences = this.props.examples.map(ex => {
        index++
        if (index - 1 > this.state.maxIndex) {
          somethingLeft = true
          return
        }
        return (<Sentence key={ex.id} sentence={ex} />)
      })
    } else {
      let ex = this.props.examples[0]
      sentences = (<Sentence key={ex.id} sentence={ex} hintMode />)
    }
    return (
      <div className='exampleSentences'>
        {sentences}
        {somethingLeft ? (
          <button className='showmore' onClick={this.handleMore}>
            Show {this.step} more...
          </button>
          ) : null}
      </div>
    )
  }
}
class Sentence extends React.Component {
  render () {
    let sent = this.props.sentence
    if (!this.props.hintMode) {
      return (
        <div className={'sentence' + (sent.prefered ? ' prefer' : '')}>
          <div className='en'>
            <WordDictPrompt text={sent.parts[0]} />
            <span className='selfword'>{sent.parts[1]}</span>
            <WordDictPrompt text={sent.parts[2]} />
          </div>
          <div className='cn'>
            {sent.cn}
          </div>
        </div>
      )
    } else {
      return (
        <div className='sentence hintMode'>
          <div className='en'>
            <WordDictPrompt text={sent.parts[0]} />
            {sent.parts[1]}
            <WordDictPrompt text={sent.parts[2]} />
          </div>
        </div>
      )
    }
  }
}

class WordImageSearchView extends React.Component {
  constructor () {
    super()
    this.ua = 'Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/48.0.2564.23 Mobile Safari/537.36'
    this.state = {}
    this._lastWord = null
    this.handleLoadFinish = this.handleLoadFinish.bind(this)
    this.handleReady = this.handleReady.bind(this)
    this.handleUnReady = this.handleUnReady.bind(this)
    this._ww = null
  }
  ww () {
    let url
    if (googleAvailable) {
      url = 'https://www.google.com/search?q=' + encodeURIComponent(this.props.word) + '&tbm=isch&hl=en'
    } else {
      url = 'https://www.bing.com/images/search?q=' + encodeURIComponent(this.props.word)
    }
    let ww = new window.WebView()
    ww.style.width = '100%'
    ww.style.height = '100%'
    ww.className = 'webview'
    ww.autosize = false
    ww.nodeintegration = false
    ww.useragent = this.ua
    ww.partition = 'google'
    ww.allowpopups = false
    ww.src = url
    this.setState({loading: true, ready: false})
    ww.addEventListener('dom-ready', this.handleLoadFinish)
    ww.addEventListener('did-stop-loading', this.handleReady)
    ww.addEventListener('did-start-loading', this.handleUnReady)
    return ww
  }
  handleLoadFinish () {
    this.setState({loading: false})
  }
  handleReady () {
    this.setState({ready: true})
  }
  handleUnReady () {
    this.setState({ready: false})
  }
  componentDidMount () {
    this.componentDidUpdate({})
  }
  componentDidUpdate (prevProps) {
    if (prevProps.word !== this.props.word) {
      let ww = this.ww()
      let selfNode = ReactDOM.findDOMNode(this._container)
      if (!selfNode) return
      if (this._ww) {
        this._ww.remove()
      }
      this._ww = ww
      selfNode.appendChild(ww)
    }
  }
  render () {
    let loading = null
    let strip = null
    if (this.state.loading) {
      loading = (
        <div className='loading'>
          <div className='loadingAnimation' /> Just a moment, connecting to
          {' ' + (googleAvailable ? 'Google' : 'Bing')} image search...
        </div>
      )
    }
    if (!this.state.ready) {
      strip = (
        <div className='strip'></div>
      )
    }
    return (
      <div className='WordImageSearchView'>
        <div ref={f => (this._container = f)}></div>
        {loading}
        {strip}
      </div>
    )
  }
}

class WordDictPrompt extends React.Component {
  constructor () {
    super()
    this.spliter = /^[A-Za-z\-]$/
  }
  render () {
    let sentence = this.props.text || ''
    let parts = []
    let lastPart = null
    let endPart = (i) => {
      if (lastPart) {
        parts.push(Object.assign({}, lastPart, {key: i}))
      }
    }
    for (let i = 0; i < sentence.length; i++ ) {
      let ch = sentence[i]
      let nch = sentence[i+1] || ''
      // One letter don't count as a word.
      if (this.spliter.test(ch) && ((lastPart && lastPart.isWord) || this.spliter.test(nch))) {
        if (lastPart && lastPart.isWord) {
          // Continue on
          lastPart.text += ch
        } else {
          // Word started.
          endPart(i)
          lastPart = {isWord: true, text: ch}
        }
      } else {
        if (lastPart && !lastPart.isWord) {
          lastPart.text += ch
        } else {
          endPart(i)
          lastPart = {isWord: false, text: ch}
        }
      }
    }
    endPart()
    this.parts = parts
    return (
      <div className="wordDictPrompt">
        {parts.map(part => {
          if (!part.isWord) {
            return (<span className="part" key={part.key}>{part.text}</span>)
          } else {
            return (<Word key={part.key} word={part.text} />)
          }
        })}
      </div>
    )
  }
}
class Word extends React.Component {
  // TODO: Query word
  constructor () {
    super()
    this.state = {
      showingDef: false,
      lookup: null,
      err: null,
      right: false
    }
    this._looking = false
    this.handleDown = this.handleDown.bind(this)
    this.handleUp = this.handleUp.bind(this)
  }
  handleDown (evt) {
    this.setState({showingDef: true})
    if (window.innerWidth - evt.clientX < 375) {
      this.setState({right: true})
    } else {
      this.setState({right: false})
    }
    if (!this._looking) {
      this._looking = true
      lookupWord(this.props.word).then(word => {
        this.setState({lookup: word})
      }).catch(err => {
        this.setState({err: err})
        this._looking = false
      })
    }
  }
  componentDidUpdate (prevProps) {
    if (prevProps.word !== this.props.word) {
      this._looking = false
      this.setState({lookup: null, err: null})
    }
  }
  handleUp () {
    this.setState({showingDef: false})
  }
  render () {
    if (this.state.showingDef) {
      let defs = 'Loading definition...'
      if (this.state.lookup) {
        defs = [(<div className="en" key="en">{this.state.lookup.collins}</div>),
          (<div className="cn" key="cn">{this.state.lookup.cn}</div>)]
      } else if (this.state.err) {
        defs = (<div className='err'>{this.state.err}</div>)
      }
      return (
        <span className="part singleWord showdef" onMouseUp={this.handleUp} onMouseLeave={this.handleUp}>
          {this.props.word}
          <div className={'defs' + (this.state.right ? ' right' : '')}>{defs}</div>
        </span>
      )
    }
    return (
      <span className="part singleWord" onMouseDown={this.handleDown}>{this.props.word}</span>
    )
  }
}

function testGoogle () {
  ipc.send('google')
}

module.exports = (mount, _ipc) => {
  ipc = _ipc
  let uiComp = ReactDOM.render(
    <MainUI />,
    mount
  )
  testGoogle()
  ipc.on('google', (evt, arg) => {
    if (!arg.err) {
      googleAvailable = true
      uiComp.setState({google: true})
    } else {
      setTimeout(testGoogle, 10000)
    }
  })
}
