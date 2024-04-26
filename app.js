const express = require('express')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const databasePath = path.join(__dirname, 'twitterClone.db')

const app = express()

app.use(express.json())

let database = null

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    })

    app.listen(3000, () =>
      console.log('Server Running at http://localhost:3000/'),
    )
  } catch (error) {
    console.log(`DB Error: ${error.message}`)
    process.exit(1)
  }
}

initializeDbAndServer()

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

app.post('/register/', async (request, response) => {
  let {username, password, name, gender} = request.body
  let hashedPassword = await bcrypt.hash(password, 10)
  let selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  let dbUser = await database.get(selectUserQuery)
  if (dbUser === undefined) {
    let createUserQuery = `
      INSERT INTO 
        user (username, name, password, gender) 
      VALUES 
        (
          '${username}', 
          '${name}',
          '${hashedPassword}', 
          '${gender}'
        );`
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      let dbResponse = await database.run(createUserQuery)
      const newUserId = dbResponse.lastID
      response.status(200)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await database.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//API 3

const convertionTweets = (name, data) => {
  return {
    username: name,
    tweet: data.tweet,
    dateTime: data.date_time,
  }
}

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = request
  const getUserIdQuery = `select user_id from user where username = '${username}';`
  const userId = await database.get(getUserIdQuery)
  const tweetsQuery = `select tweet.* from tweet 
    join follower on tweet.user_id = follower.following_user_id 
    where follower.following_user_id = ${userId.user_id} 
    order by tweet_id desc limit 4;`
  const tweets = await database.all(tweetsQuery)

  response.send(tweets.map(each => convertionTweets(username, each)))
})

//API 4

app.get('/user/following/', authenticateToken, async (req, res) => {
  const {username} = req
  const user = await database.get(
    'SELECT user_id FROM user WHERE username = ?',
    username,
  )
  const followingNames = await database.all(
    `
    SELECT u.name 
    FROM user AS u
    JOIN follower AS f ON u.user_id = f.following_user_id 
    WHERE f.follower_user_id = ?
  `,
    user.user_id,
  )

  res.send(followingNames.map(row => row.name))
})

//API 5
app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username} = request
  const user = await database.get(
    'SELECT user_id FROM user WHERE username = ?',
    [username],
  )
  const followersQuery = `SELECT user.username FROM user JOIN follower 
    ON user.user_id = follower.follower_user_id WHERE follower.follower_user_id = ?`
  const followers = await database.all(followersQuery, [user.user_id])
  response.send(followers.map(each => each.username))
})

//API 6
app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {username} = request
  const user = await database.get(
    'SELECT user_id FROM user WHERE username = ?',
    [username],
  )
  const {tweetId} = request.params
  const tweetsQuery = `
SELECT
*
FROM tweet
WHERE tweet_id=${tweetId};
`
  const tweetResult = await database.get(tweetsQuery)
  const userFollowersQuery = `
SELECT
*
FROM follower INNER JOIN user on user.user_id = follower.following_user_id
WHERE follower.follower_user_id = ${user.user_id};`
  const userFollowers = await database.all(userFollowersQuery)
  if (
    userFollowers.some(item => item.following_user_id === tweetResult.user_id)
  ) {
    const tweetResponse = {
      tweet: tweetResult.tweet,
      dateTime: tweetResult.date_time,
    }
    response.status(200).send(tweetResponse)
  } else {
    response.status(401).send('Invalid Request')
  }
})

//API 7
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {username} = request
    const user = await database.get(
      'SELECT user_id FROM user WHERE username = ?',
      [username],
    )
    const {tweetId} = request.params
    const likesQuery = `
  select * from like where tweet_id = ${tweetId};
  `
    const likesResult = database.get(likesQuery)
    const userFollowersQuery = `
SELECT
*
FROM follower INNER JOIN user on user.user_id = follower.following_user_id
WHERE follower.follower_user_id = ${user.user_id};`
    const userFollowers = await database.all(userFollowersQuery)
    if (
      userFollowers.some(item => item.following_user_id === likesResult.user_id)
    ) {
      const likeResponse = {
        likes: userFollowers,
      }
      response.status(200).send(likeResponse)
    } else {
      response.status(401).send('Invalid Request')
    }
  },
)

//API 9
app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const user = await database.get(
    'SELECT user_id FROM user WHERE username = ?',
    [username],
  )
  const tweetsQuery = `
    SELECT 
      T.tweet,
      (SELECT COUNT(*) FROM like L WHERE L.tweet_id = T.tweet_id) as likes,
      (SELECT COUNT(*) FROM reply R WHERE R.tweet_id = T.tweet_id) as replies,
      T.date_time as dateTime
    FROM tweet T
    WHERE T.user_id = ?`
  const tweets = await database.all(tweetsQuery, [user.user_id])
  response.send(tweets.map(each => each))
})

//API 10
app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = request
  const user = await database.get(
    'SELECT user_id FROM user WHERE username = ?',
    [username],
  )
  const {tweet} = request.body
  const now = new Date()
  const postTweetQuery = `insert into tweet (tweet,user_id,date_time)
  values ('${tweet}',${user.user_id},'${now}');`
  const postTweet = await database.run(postTweetQuery)
  response.send('Created a Tweet')
})

//API 11

module.exports = app
