const core = require('@actions/core')
const { google } = require('googleapis')
const { Octokit } = require("@octokit/rest")
const mergeEvents = require('./src/mergeEvents')

const run = async () => {
  try {
    const jsonPath = core.getInput('json-path')
    const repoToken = core.getInput('repo-token')
    const token = getToken()
    const creds = getCredentials()
    const client = getOAuth2Client(token, creds)
    const calendar = google.calendar({ version: 'v3', auth: client })
    const calendarId = core.getInput('calendar-id')

    calendar.events.list({
      calendarId: calendarId,
      timeMin: (new Date()).toISOString(),
      maxResults: 100,
      singleEvents: true,
      orderBy: 'startTime',
    }, async (err, res) => {
      if (err) return core.error('The API returned an error: ' + err)
      const events = res.data.items
      if (events.length) {
        events.map((event, i) => {
          const start = event.start.dateTime || event.start.date
          core.info(`${start} - ${event.summary}`)
        })
        await saveToFile(repoToken, events, jsonPath)
      } else {
        core.info('No upcoming events found.')
      }
    })

    core.info(`Running action`)
  } catch (err) {
    core.error(err.message)
  }
}

/**
 * Gets the Google token from the core.       
 * @returns {string} The Google token.       
 */
const getToken = () => {
  const token = core.getInput('google-token')
  if (token) try { return JSON.parse(token) } catch (e) { throw new Error(`Failed to parse token: ${e}`) }
  throw new Error('Missing Token')
}

/**
 * Gets the credentials from the input.
 * @returns {object} The credentials object.
 */
const getCredentials = () => {
  const token = core.getInput('google-credentials')
  if (token) try { return JSON.parse(token) } catch (e) { throw new Error(`Failed to parse credentials: ${e}`) }
  throw new Error('Missing Credentials')
}

/**
 * Takes in a token and credentials and returns an OAuth2Client object.       
 * @param {string} token - the token to use for authentication       
 * @param {Credentials} credentials - the credentials to use for authentication       
 * @returns {OAuth2Client} - the OAuth2Client object       
 */
const getOAuth2Client = (token, credentials) => {
  const { client_secret, client_id, redirect_uris } = credentials.installed
  const oAuth2Client = new google.auth.OAuth2(
    client_id, client_secret, redirect_uris[0])
  oAuth2Client.setCredentials(token)
  return oAuth2Client
}

/**
 * Takes in a list of events and merges them with the existing events in the file.       
 * @param {Array<Event>} events - the list of events to merge with the existing events       
 * @param {Array<Event>} existingEvents - the list of existing events to merge with the new events       
 * @returns None       
 */
const saveToFile = async (repoToken, events, jsonPath) => {
  const octokit = new Octokit({
    auth: repoToken,
  })
  const username = process.env.GITHUB_REPOSITORY.split("/")[0]
  const repo = process.env.GITHUB_REPOSITORY.split("/")[1]
  let options = {
    // replace the owner and email with your own details
    owner: username,
    repo: repo,
    path: jsonPath,
    message: "Updated json programmatically",
    content: '',
    committer: {
      name: `Octokit Bot`,
      email: "octokit@example.com",
    },
    author: {
      name: "Octokit Bot",
      email: "octokit@example.com",
    },
  }

  let existingEvents = { events: [] }
  try {
     // get existing file so we can merge data in
    const { data } = await octokit.repos.getContent({
      owner: options.owner,
      repo: options.repo,
      path: options.path,
    })
    options.sha = data.sha
    existingEvents = JSON.parse(Buffer.from(data.content, 'base64'))
  } catch (err) {
    core.error("Error getting content: " + err.message)
  }

  const existingEventsJsonBefore = JSON.stringify(existingEvents, null, '  ')
  mergeEvents(events, existingEvents)
  const existingEventsJson = JSON.stringify(existingEvents, null, '  ')
  if (existingEventsJsonBefore === existingEventsJson) return

  options.content = Buffer.from(existingEventsJson).toString('base64')
  const { data2 } = await octokit.repos.createOrUpdateFileContents(options)  
  return data2
}

run()