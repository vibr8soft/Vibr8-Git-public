const request = require('supertest');

// Mock isomorphic-git before requiring the app
jest.mock('isomorphic-git', () => ({
  listBranches: jest.fn(),
  log: jest.fn(),
  resolveRef: jest.fn(),
  getConfig: jest.fn(),
  readCommit: jest.fn(),
  walk: jest.fn(),
  TREE: jest.fn((opts) => opts),
  branch: jest.fn(),
  checkout: jest.fn(),
  deleteBranch: jest.fn(),
  statusMatrix: jest.fn(),
  add: jest.fn(),
  resetIndex: jest.fn(),
  commit: jest.fn(),
  merge: jest.fn(),
  currentBranch: jest.fn(),
  fetch: jest.fn(),
  push: jest.fn(),
  clone: jest.fn(),
  listRemotes: jest.fn(),
}));

const git = require('isomorphic-git');
const app = require('./server');

describe('Git Client API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // POST /api/log
  // ============================================
  describe('POST /api/log', () => {
    it('should return commits with branch information', async () => {
      const mockCommit = {
        oid: 'abc123',
        commit: {
          message: 'Initial commit',
          author: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
          committer: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
          parent: [],
        },
      };

      git.listBranches
        .mockResolvedValueOnce(['main'])
        .mockResolvedValueOnce(['main']);
      git.log.mockResolvedValue([mockCommit]);
      git.resolveRef.mockResolvedValue('abc123');

      const res = await request(app)
        .post('/api/log')
        .send({ repoPath: '/test/repo', depth: 10 });

      expect(res.status).toBe(200);
      expect(res.body.commits).toHaveLength(1);
      expect(res.body.commits[0].oid).toBe('abc123');
      expect(res.body.commits[0].branches).toContain('main');
    });

    it('should handle git errors gracefully', async () => {
      git.listBranches.mockRejectedValue(new Error('Not a git repository'));

      const res = await request(app)
        .post('/api/log')
        .send({ repoPath: '/invalid/repo' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Not a git repository');
    });

    it('should use default depth of 100', async () => {
      git.listBranches
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .post('/api/log')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(200);
      expect(res.body.commits).toEqual([]);
    });
  });

  // ============================================
  // POST /api/commit-details
  // ============================================
  describe('POST /api/commit-details', () => {
    it('should return commit details with files changed', async () => {
      const mockCommit = {
        commit: {
          message: 'Add feature',
          author: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
          committer: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
          parent: ['parent123'],
        },
      };

      git.readCommit.mockResolvedValue(mockCommit);
      git.walk.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/commit-details')
        .send({ repoPath: '/test/repo', oid: 'abc123' });

      expect(res.status).toBe(200);
      expect(res.body.oid).toBe('abc123');
      expect(res.body.message).toBe('Add feature');
      expect(res.body.parents).toEqual(['parent123']);
    });

    it('should return 400 when repoPath is missing', async () => {
      const res = await request(app)
        .post('/api/commit-details')
        .send({ oid: 'abc123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required parameters');
    });

    it('should return 400 when oid is missing', async () => {
      const res = await request(app)
        .post('/api/commit-details')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required parameters');
    });

    it('should handle root commit (no parents)', async () => {
      const mockCommit = {
        commit: {
          message: 'Initial commit',
          author: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
          committer: { name: 'Test', email: 'test@test.com', timestamp: 1700000000 },
          parent: null,
        },
      };

      git.readCommit.mockResolvedValue(mockCommit);
      git.walk.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/commit-details')
        .send({ repoPath: '/test/repo', oid: 'root123' });

      expect(res.status).toBe(200);
      expect(res.body.parents).toEqual([]);
    });

    it('should handle git errors', async () => {
      git.readCommit.mockRejectedValue(new Error('Object not found'));

      const res = await request(app)
        .post('/api/commit-details')
        .send({ repoPath: '/test/repo', oid: 'invalid' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Object not found');
    });
  });

  // ============================================
  // POST /api/branches
  // ============================================
  describe('POST /api/branches', () => {
    it('should return local and remote branches with tracking info', async () => {
      git.listBranches
        .mockResolvedValueOnce(['main', 'feature'])
        .mockResolvedValueOnce(['main', 'develop']);
      git.currentBranch.mockResolvedValue('main');
      git.getConfig
        .mockResolvedValueOnce('origin')
        .mockResolvedValueOnce('refs/heads/main')
        .mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/branches')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(200);
      expect(res.body.local).toEqual(['main', 'feature']);
      expect(res.body.remote).toEqual(['origin/main', 'origin/develop']);
      expect(res.body.current).toBe('main');
      expect(res.body.tracking.main).toBe('origin/main');
    });

    it('should handle git errors', async () => {
      git.listBranches.mockRejectedValue(new Error('Not a git repository'));

      const res = await request(app)
        .post('/api/branches')
        .send({ repoPath: '/invalid/repo' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Not a git repository');
    });
  });

  // ============================================
  // POST /api/branch/create
  // ============================================
  describe('POST /api/branch/create', () => {
    it('should create a new branch', async () => {
      git.branch.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/branch/create')
        .send({ repoPath: '/test/repo', branchName: 'new-feature' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.branch).toBe('new-feature');
      expect(git.branch).toHaveBeenCalledWith(
        expect.objectContaining({ ref: 'new-feature' })
      );
    });

    it('should create and checkout branch when checkout is true', async () => {
      git.branch.mockResolvedValue(undefined);
      git.checkout.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/branch/create')
        .send({ repoPath: '/test/repo', branchName: 'new-feature', checkout: true });

      expect(res.status).toBe(200);
      expect(git.checkout).toHaveBeenCalledWith(
        expect.objectContaining({ ref: 'new-feature' })
      );
    });

    it('should handle branch already exists error', async () => {
      git.branch.mockRejectedValue(new Error('Branch already exists'));

      const res = await request(app)
        .post('/api/branch/create')
        .send({ repoPath: '/test/repo', branchName: 'main' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Branch already exists');
    });
  });

  // ============================================
  // POST /api/branch/checkout
  // ============================================
  describe('POST /api/branch/checkout', () => {
    it('should checkout an existing branch', async () => {
      git.checkout.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/branch/checkout')
        .send({ repoPath: '/test/repo', branchName: 'feature' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.branch).toBe('feature');
    });

    it('should handle invalid branch error', async () => {
      git.checkout.mockRejectedValue(new Error('Branch not found'));

      const res = await request(app)
        .post('/api/branch/checkout')
        .send({ repoPath: '/test/repo', branchName: 'nonexistent' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Branch not found');
    });
  });

  // ============================================
  // POST /api/branch/delete
  // ============================================
  describe('POST /api/branch/delete', () => {
    it('should delete a branch', async () => {
      git.deleteBranch.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/branch/delete')
        .send({ repoPath: '/test/repo', branchName: 'old-feature' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should handle delete current branch error', async () => {
      git.deleteBranch.mockRejectedValue(new Error('Cannot delete current branch'));

      const res = await request(app)
        .post('/api/branch/delete')
        .send({ repoPath: '/test/repo', branchName: 'main' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Cannot delete current branch');
    });
  });

  // ============================================
  // POST /api/status
  // ============================================
  describe('POST /api/status', () => {
    it('should return categorized file status', async () => {
      git.statusMatrix.mockResolvedValue([
        ['modified.js', 1, 2, 1],      // modified (unstaged)
        ['untracked.js', 0, 2, 0],     // untracked
        ['added.js', 0, 2, 2],         // added (staged)
        ['deleted.js', 1, 0, 1],       // deleted
        ['staged-modified.js', 1, 2, 2], // modified (staged)
      ]);

      const res = await request(app)
        .post('/api/status')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(200);
      expect(res.body.modified).toContain('modified.js');
      expect(res.body.modified).toContain('staged-modified.js');
      expect(res.body.untracked).toContain('untracked.js');
      expect(res.body.added).toContain('added.js');
      expect(res.body.deleted).toContain('deleted.js');
    });

    it('should return empty arrays for clean working directory', async () => {
      git.statusMatrix.mockResolvedValue([]);

      const res = await request(app)
        .post('/api/status')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(200);
      expect(res.body.modified).toEqual([]);
      expect(res.body.untracked).toEqual([]);
      expect(res.body.added).toEqual([]);
      expect(res.body.deleted).toEqual([]);
    });

    it('should handle git errors', async () => {
      git.statusMatrix.mockRejectedValue(new Error('Not a git repository'));

      const res = await request(app)
        .post('/api/status')
        .send({ repoPath: '/invalid/repo' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Not a git repository');
    });
  });

  // ============================================
  // POST /api/add
  // ============================================
  describe('POST /api/add', () => {
    it('should stage a file', async () => {
      git.add.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/add')
        .send({ repoPath: '/test/repo', filepath: 'newfile.js' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(git.add).toHaveBeenCalledWith(
        expect.objectContaining({ filepath: 'newfile.js' })
      );
    });

    it('should handle file not found error', async () => {
      git.add.mockRejectedValue(new Error('File not found'));

      const res = await request(app)
        .post('/api/add')
        .send({ repoPath: '/test/repo', filepath: 'nonexistent.js' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('File not found');
    });
  });

  // ============================================
  // POST /api/reset
  // ============================================
  describe('POST /api/reset', () => {
    it('should unstage a file', async () => {
      git.resetIndex.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/reset')
        .send({ repoPath: '/test/repo', filepath: 'staged.js' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(git.resetIndex).toHaveBeenCalledWith(
        expect.objectContaining({ filepath: 'staged.js' })
      );
    });

    it('should handle git errors', async () => {
      git.resetIndex.mockRejectedValue(new Error('Reset failed'));

      const res = await request(app)
        .post('/api/reset')
        .send({ repoPath: '/test/repo', filepath: 'file.js' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Reset failed');
    });
  });

  // ============================================
  // POST /api/commit
  // ============================================
  describe('POST /api/commit', () => {
    it('should create a commit', async () => {
      git.commit.mockResolvedValue('newcommitsha123');

      const res = await request(app)
        .post('/api/commit')
        .send({
          repoPath: '/test/repo',
          message: 'Add new feature',
          author: { name: 'Test User', email: 'test@test.com' },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sha).toBe('newcommitsha123');
    });

    it('should handle no staged files error', async () => {
      git.commit.mockRejectedValue(new Error('Nothing to commit'));

      const res = await request(app)
        .post('/api/commit')
        .send({
          repoPath: '/test/repo',
          message: 'Empty commit',
          author: { name: 'Test', email: 'test@test.com' },
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Nothing to commit');
    });
  });

  // ============================================
  // POST /api/merge
  // ============================================
  describe('POST /api/merge', () => {
    it('should merge branches successfully', async () => {
      git.currentBranch.mockResolvedValue('main');
      git.merge.mockResolvedValue({ oid: 'mergecommit123' });

      const res = await request(app)
        .post('/api/merge')
        .send({ repoPath: '/test/repo', theirBranch: 'feature' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(git.merge).toHaveBeenCalledWith(
        expect.objectContaining({
          ours: 'main',
          theirs: 'feature',
        })
      );
    });

    it('should handle merge conflicts', async () => {
      git.currentBranch.mockResolvedValue('main');
      git.merge.mockRejectedValue(new Error('Merge conflict'));

      const res = await request(app)
        .post('/api/merge')
        .send({ repoPath: '/test/repo', theirBranch: 'feature' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Merge conflict');
      expect(res.body.conflicts).toBe(true);
    });
  });

  // ============================================
  // POST /api/fetch
  // ============================================
  describe('POST /api/fetch', () => {
    it('should fetch from remote', async () => {
      git.fetch.mockResolvedValue({ fetchHead: 'abc123' });

      const res = await request(app)
        .post('/api/fetch')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should fetch with credentials', async () => {
      git.fetch.mockResolvedValue({ fetchHead: 'abc123' });

      const res = await request(app)
        .post('/api/fetch')
        .send({
          repoPath: '/test/repo',
          credentials: { username: 'user', password: 'token' },
        });

      expect(res.status).toBe(200);
      expect(git.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          onAuth: expect.any(Function),
        })
      );
    });

    it('should handle authentication failure', async () => {
      git.fetch.mockRejectedValue(new Error('Authentication failed'));

      const res = await request(app)
        .post('/api/fetch')
        .send({
          repoPath: '/test/repo',
          credentials: { username: 'user', password: 'wrong' },
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Authentication failed');
    });
  });

  // ============================================
  // POST /api/pull
  // ============================================
  describe('POST /api/pull', () => {
    it('should pull (fetch + merge) successfully', async () => {
      git.currentBranch.mockResolvedValue('main');
      git.fetch.mockResolvedValue({ fetchHead: 'abc123' });
      git.merge.mockResolvedValue({ oid: 'mergesha' });

      const res = await request(app)
        .post('/api/pull')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(git.fetch).toHaveBeenCalled();
      expect(git.merge).toHaveBeenCalledWith(
        expect.objectContaining({
          ours: 'main',
          theirs: 'origin/main',
        })
      );
    });

    it('should handle fetch failure', async () => {
      git.currentBranch.mockResolvedValue('main');
      git.fetch.mockRejectedValue(new Error('Network error'));

      const res = await request(app)
        .post('/api/pull')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Network error');
    });

    it('should handle merge failure after fetch', async () => {
      git.currentBranch.mockResolvedValue('main');
      git.fetch.mockResolvedValue({ fetchHead: 'abc123' });
      git.merge.mockRejectedValue(new Error('Merge conflict'));

      const res = await request(app)
        .post('/api/pull')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Merge conflict');
    });
  });

  // ============================================
  // POST /api/push
  // ============================================
  describe('POST /api/push', () => {
    it('should push to remote', async () => {
      git.push.mockResolvedValue({ ok: true });

      const res = await request(app)
        .post('/api/push')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should push with credentials', async () => {
      git.push.mockResolvedValue({ ok: true });

      const res = await request(app)
        .post('/api/push')
        .send({
          repoPath: '/test/repo',
          credentials: { username: 'user', password: 'token' },
        });

      expect(res.status).toBe(200);
      expect(git.push).toHaveBeenCalledWith(
        expect.objectContaining({
          onAuth: expect.any(Function),
        })
      );
    });

    it('should handle push rejection', async () => {
      git.push.mockRejectedValue(new Error('Push rejected: non-fast-forward'));

      const res = await request(app)
        .post('/api/push')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Push rejected: non-fast-forward');
    });
  });

  // ============================================
  // POST /api/clone
  // ============================================
  describe('POST /api/clone', () => {
    it('should clone a repository', async () => {
      git.clone.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/clone')
        .send({
          url: 'https://github.com/user/repo.git',
          dir: '/path/to/clone',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(git.clone).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://github.com/user/repo.git',
          dir: '/path/to/clone',
        })
      );
    });

    it('should clone with credentials for private repos', async () => {
      git.clone.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/clone')
        .send({
          url: 'https://github.com/user/private-repo.git',
          dir: '/path/to/clone',
          credentials: { username: 'user', password: 'token' },
        });

      expect(res.status).toBe(200);
      expect(git.clone).toHaveBeenCalledWith(
        expect.objectContaining({
          onAuth: expect.any(Function),
        })
      );
    });

    it('should handle invalid URL error', async () => {
      git.clone.mockRejectedValue(new Error('Repository not found'));

      const res = await request(app)
        .post('/api/clone')
        .send({
          url: 'https://github.com/user/nonexistent.git',
          dir: '/path/to/clone',
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Repository not found');
    });
  });

  // ============================================
  // POST /api/repo-info
  // ============================================
  describe('POST /api/repo-info', () => {
    it('should return repository info', async () => {
      git.currentBranch.mockResolvedValue('main');
      git.listRemotes.mockResolvedValue([
        { remote: 'origin', url: 'https://github.com/user/repo.git' },
      ]);

      const res = await request(app)
        .post('/api/repo-info')
        .send({ repoPath: '/test/repo' });

      expect(res.status).toBe(200);
      expect(res.body.currentBranch).toBe('main');
      expect(res.body.remotes).toHaveLength(1);
      expect(res.body.remotes[0].remote).toBe('origin');
    });

    it('should handle not a repository error', async () => {
      git.currentBranch.mockRejectedValue(new Error('Not a git repository'));

      const res = await request(app)
        .post('/api/repo-info')
        .send({ repoPath: '/not/a/repo' });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Not a git repository');
    });
  });
});
