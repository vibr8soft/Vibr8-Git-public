const express = require('express');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

// Get repository log with graph data
app.post('/api/log', async (req, res) => {
  try {
    const { repoPath, depth = 100 } = req.body;

    // Get all branches (local and remote)
    const branches = await git.listBranches({ fs, dir: repoPath });
    const remoteBranches = await git.listBranches({ fs, dir: repoPath, remote: 'origin' });

    // Collect commits from all branches
    const commitMap = new Map();
    const allRefs = [...branches, ...remoteBranches.map(b => `origin/${b}`)];

    for (const ref of allRefs) {
      try {
        const commits = await git.log({
          fs,
          dir: repoPath,
          depth: depth,
          ref: ref
        });

        for (const commit of commits) {
          if (!commitMap.has(commit.oid)) {
            commitMap.set(commit.oid, {
              oid: commit.oid,
              message: commit.commit.message,
              author: commit.commit.author,
              committer: commit.commit.committer,
              parents: commit.commit.parent || [],
              branches: [],
              remoteBranches: [],
              timestamp: commit.commit.author.timestamp
            });
          }
        }
      } catch (e) {
        // Skip refs that can't be resolved
      }
    }

    // Enrich commits with branch information and tracking
    for (const branch of branches) {
      try {
        const branchOid = await git.resolveRef({ fs, dir: repoPath, ref: branch });
        if (commitMap.has(branchOid)) {
          commitMap.get(branchOid).branches.push(branch);
        }
      } catch (e) {}
    }

    for (const remoteBranch of remoteBranches) {
      try {
        const branchOid = await git.resolveRef({ fs, dir: repoPath, ref: `origin/${remoteBranch}` });
        if (commitMap.has(branchOid)) {
          commitMap.get(branchOid).remoteBranches.push(`origin/${remoteBranch}`);
        }
      } catch (e) {}
    }

    // Convert to array and sort by timestamp (newest first)
    const enrichedCommits = Array.from(commitMap.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, depth);

    res.json({ commits: enrichedCommits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get commit details including files changed
app.post('/api/commit-details', async (req, res) => {
  try {
    const { repoPath, oid } = req.body;

    // Validate required parameters
    if (!repoPath || !oid) {
      return res.status(400).json({ error: 'Missing required parameters: repoPath and oid are required' });
    }

    // Get the commit object
    const commit = await git.readCommit({ fs, dir: repoPath, oid });

    // Get the tree for this commit
    const { commit: commitData } = commit;

    // Get files changed by comparing with parent
    const files = [];
    const parentOid = commitData.parent && commitData.parent[0];

    if (parentOid) {
      // Compare trees between this commit and its parent
      // Note: git.walk returns undefined when map returns null, so we collect via side effect
      await git.walk({
        fs,
        dir: repoPath,
        trees: [git.TREE({ ref: parentOid }), git.TREE({ ref: oid })],
        map: async function(filepath, [parent, current]) {
          if (filepath === '.') return;

          // Get types - entries can be null if file doesn't exist in that tree
          const parentType = parent ? await parent.type() : null;
          const currentType = current ? await current.type() : null;

          // Skip if both are directories (or both null, which shouldn't happen)
          const parentIsBlob = parentType === 'blob';
          const currentIsBlob = currentType === 'blob';
          if (!parentIsBlob && !currentIsBlob) return;

          // Get OIDs for comparison
          const parentBlobOid = parentIsBlob ? await parent.oid() : null;
          const currentBlobOid = currentIsBlob ? await current.oid() : null;

          // Skip if unchanged
          if (parentBlobOid === currentBlobOid) return;

          let status;
          if (!parentBlobOid && currentBlobOid) {
            status = 'added';
          } else if (parentBlobOid && !currentBlobOid) {
            status = 'deleted';
          } else {
            status = 'modified';
          }

          files.push({ filepath, status });
        }
      });
    } else {
      // Root commit - all files are "added"
      await git.walk({
        fs,
        dir: repoPath,
        trees: [git.TREE({ ref: oid })],
        map: async function(filepath, [entry]) {
          if (filepath === '.') return;
          const type = await entry.type();
          if (type !== 'blob') return;
          files.push({ filepath, status: 'added' });
        }
      });
    }

    res.json({
      oid: oid,
      message: commitData.message,
      author: commitData.author,
      committer: commitData.committer,
      parents: commitData.parent || [],
      files: files
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all branches (local and remote)
app.post('/api/branches', async (req, res) => {
  try {
    const { repoPath } = req.body;

    const localBranches = await git.listBranches({ fs, dir: repoPath });
    const remoteBranches = await git.listBranches({ fs, dir: repoPath, remote: 'origin' });
    const currentBranch = await git.currentBranch({ fs, dir: repoPath, fullname: false });

    // Get tracking information for local branches
    const tracking = {};
    for (const branch of localBranches) {
      try {
        const config = await git.getConfig({
          fs,
          dir: repoPath,
          path: `branch.${branch}.remote`
        });

        if (config) {
          const remoteBranch = await git.getConfig({
            fs,
            dir: repoPath,
            path: `branch.${branch}.merge`
          });

          if (remoteBranch) {
            // Extract branch name from refs/heads/branchname
            const remoteBranchName = remoteBranch.replace('refs/heads/', '');
            tracking[branch] = `${config}/${remoteBranchName}`;
          }
        }
      } catch (e) {
        // Branch doesn't have tracking info
      }
    }

    res.json({
      local: localBranches,
      remote: remoteBranches.map(b => `origin/${b}`),
      current: currentBranch,
      tracking: tracking
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new branch
app.post('/api/branch/create', async (req, res) => {
  try {
    const { repoPath, branchName, checkout = false } = req.body;
    
    await git.branch({ fs, dir: repoPath, ref: branchName });
    
    if (checkout) {
      await git.checkout({ fs, dir: repoPath, ref: branchName });
    }
    
    res.json({ success: true, branch: branchName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Checkout branch
app.post('/api/branch/checkout', async (req, res) => {
  try {
    const { repoPath, branchName } = req.body;
    
    await git.checkout({ fs, dir: repoPath, ref: branchName });
    
    res.json({ success: true, branch: branchName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete branch
app.post('/api/branch/delete', async (req, res) => {
  try {
    const { repoPath, branchName } = req.body;
    
    await git.deleteBranch({ fs, dir: repoPath, ref: branchName });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get file status
app.post('/api/status', async (req, res) => {
  try {
    const { repoPath } = req.body;
    
    const FILE = 0, HEAD = 1, WORKDIR = 2, STAGE = 3;
    const matrix = await git.statusMatrix({ fs, dir: repoPath });
    
    const status = {
      modified: [],
      added: [],
      deleted: [],
      untracked: []
    };

    for (const [filepath, headStatus, workdirStatus, stageStatus] of matrix) {
      if (headStatus === 1 && workdirStatus === 2 && stageStatus === 1) {
        status.modified.push(filepath);
      } else if (headStatus === 0 && workdirStatus === 2 && stageStatus === 0) {
        status.untracked.push(filepath);
      } else if (headStatus === 0 && workdirStatus === 2 && stageStatus === 2) {
        status.added.push(filepath);
      } else if (headStatus === 1 && workdirStatus === 0 && stageStatus === 1) {
        status.deleted.push(filepath);
      } else if (headStatus === 1 && workdirStatus === 2 && stageStatus === 2) {
        status.modified.push(filepath);
      }
    }

    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stage files
app.post('/api/add', async (req, res) => {
  try {
    const { repoPath, filepath } = req.body;
    
    await git.add({ fs, dir: repoPath, filepath });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unstage files
app.post('/api/reset', async (req, res) => {
  try {
    const { repoPath, filepath } = req.body;
    
    await git.resetIndex({ fs, dir: repoPath, filepath });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Commit
app.post('/api/commit', async (req, res) => {
  try {
    const { repoPath, message, author } = req.body;
    
    const sha = await git.commit({
      fs,
      dir: repoPath,
      message,
      author: {
        name: author.name,
        email: author.email
      }
    });
    
    res.json({ success: true, sha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Merge
app.post('/api/merge', async (req, res) => {
  try {
    const { repoPath, theirBranch } = req.body;
    
    const result = await git.merge({
      fs,
      dir: repoPath,
      ours: await git.currentBranch({ fs, dir: repoPath, fullname: false }),
      theirs: theirBranch,
      author: {
        name: 'Git Client User',
        email: 'user@localhost'
      }
    });
    
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message, conflicts: true });
  }
});

// Fetch
app.post('/api/fetch', async (req, res) => {
  try {
    const { repoPath, remote = 'origin', credentials } = req.body;
    
    const result = await git.fetch({
      fs,
      http,
      dir: repoPath,
      remote,
      ...(credentials && {
        onAuth: () => credentials
      })
    });
    
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pull
app.post('/api/pull', async (req, res) => {
  try {
    const { repoPath, remote = 'origin', credentials } = req.body;
    
    const currentBranch = await git.currentBranch({ fs, dir: repoPath, fullname: false });
    
    // Fetch first
    await git.fetch({
      fs,
      http,
      dir: repoPath,
      remote,
      ...(credentials && {
        onAuth: () => credentials
      })
    });
    
    // Then merge
    await git.merge({
      fs,
      dir: repoPath,
      ours: currentBranch,
      theirs: `${remote}/${currentBranch}`,
      author: {
        name: 'Git Client User',
        email: 'user@localhost'
      }
    });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Push
app.post('/api/push', async (req, res) => {
  try {
    const { repoPath, remote = 'origin', credentials } = req.body;
    
    const result = await git.push({
      fs,
      http,
      dir: repoPath,
      remote,
      ...(credentials && {
        onAuth: () => credentials
      })
    });
    
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clone repository
app.post('/api/clone', async (req, res) => {
  try {
    const { url, dir, credentials } = req.body;
    
    await git.clone({
      fs,
      http,
      dir,
      url,
      ...(credentials && {
        onAuth: () => credentials
      })
    });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get repository info
app.post('/api/repo-info', async (req, res) => {
  try {
    const { repoPath } = req.body;
    
    const currentBranch = await git.currentBranch({ fs, dir: repoPath, fullname: false });
    const remotes = await git.listRemotes({ fs, dir: repoPath });
    
    res.json({ 
      currentBranch,
      remotes
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n========================================`);
    console.log(`Git Client running at http://localhost:${PORT}`);
    console.log(`========================================`);
    console.log(`Press Ctrl+C to stop\n`);
  });
}

module.exports = app;
