import fs from 'fs'
import {Octokit} from "@octokit/rest"
import {retry} from "@octokit/plugin-retry"
import {throttling} from "@octokit/plugin-throttling"

const organization = 'org-name-here'

const _Octokit = Octokit.plugin(retry, throttling)

const client = new _Octokit({
    auth: process.env.GITHUB_PAT,
    throttle: {
        onRateLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Request quota exhausted for request ${options.method} ${options.url}`)
            console.log(options.request.retryCount)
            if (options.request.retryCount <= 1) {
                octokit.log.warn(`Retrying after ${retryAfter} seconds!`)
                return true
            }
        },
        onSecondaryRateLimit: (retryAfter, options, octokit) => {
            octokit.log.warn(`Abuse detected for request ${options.method} ${options.url}`)
            return true
        },
    }
})

//todo accept list of repos as a parameter
const repoList = ''

const repositories = repoList.split(',');

const getQuery = async (repo) => {
  const query = `query($org: String!, $repo: String!) {
    organization(login: $org) {
      repository(name: $repo) {
        collaborators(affiliation: ALL) {
          edges {
            permission
            node {
              id
              name
              login
              email
              organizationVerifiedDomainEmails(login: $org)
            }
          }
        }
      }
    }
  }`

  const repoUsers = [];
  const response = await client.graphql(query, {
    org: organization,
    repo: repo
  })
  repoUsers.push(...response.organization.repository.collaborators.edges) 
  return repoUsers;
}

const processRepositories= async (repos) => {
  let users = [];
  for (let repo of repos) {

    // setTimeout(async () => {
      let repoUsers = await getQuery(repo);
      console.log("finished " + repo);
      // console.log(repoUsers);  
      for (let user of repoUsers) {

        //check if user.node.login matches any of the users in the users array
        let userIndex = users.findIndex(userInArray => userInArray.login === user.node.login);

        //if userIndex is -1, then the user is not in the users array
        if (userIndex === -1) {
          let login = user.node.login;
          let name = user.node.name;
          let email = user.node.organizationVerifiedDomainEmails[0];
          let permissions = new Array(repos.length).fill(null).map(() => []);

          if (email) {
            let emailName = email.split("@")[0];
            // if there are hyphens in emailName, capitalize the first letter following the hyphen
            if (emailName.includes("-")) {
              let emailNameArray = emailName.split("-");
              emailNameArray.forEach((name, index) => {
                if (index > 0) {
                  emailNameArray[index] = name.charAt(0).toUpperCase() + name.slice(1);
                }
              })
              emailName = emailNameArray.join("");
            }
            let emailNameSplit = emailName.split(".");
            //firstName is first part of email and capitalized
            let firstName = emailNameSplit[0].charAt(0).toUpperCase() + emailNameSplit[0].slice(1);
            //lastName is last item in emailNameSplit and capitalized
            let lastName = emailNameSplit[emailNameSplit.length - 1].charAt(0).toUpperCase() + emailNameSplit[emailNameSplit.length - 1].slice(1).replace(/\d/g, '');
            // set name to firstName + lastName
            name = firstName + " " + lastName;
          } else {
            email = user.node.email
          }
          //create a new user object and push it to the users array
          users.push({
            login: login,
            name: name,
            email: email,
            permissions: permissions
          });
          //look up the newly created user's index in the users array
          userIndex = users.findIndex(userInArray => userInArray.login === user.node.login);
        }

        //this is some rube goldberg domino bs to help generate a csv at the end of all this
        users[userIndex].permissions[repos.indexOf(repo)] = user.permission;

      }

  }
  // console.log(users);
  let csv = "login,name,email," + repositories.join(",");
  for (let user of users) {
    csv += "\n" + user.login + "," + user.name + "," + user.email + "," + user.permissions.join(",");
  }
  fs.writeFileSync('permissionsAudit.csv', csv);
  console.log(csv);
  return users;
};

processRepositories(repositories);