let currentRepo = '';
let authorConfig = {
    name: localStorage.getItem('git.author.name') || 'User',
    email: localStorage.getItem('git.author.email') || 'user@localhost'
};

// API Helper
async function apiCall(endpoint, data = {}) {
    const response = await fetch(`/api${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: currentRepo, ...data })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Request failed');
    }
    
    return response.json();
}

// Load Repository
async function loadRepo() {
    const path = document.getElementById('repoPath').value.trim();
    if (!path) {
        alert('Please enter a repository path');
        return;
    }
    
    currentRepo = path;
    
    try {
        const info = await apiCall('/repo-info');
        document.getElementById('currentBranch').textContent = info.currentBranch || 'unknown';
        document.getElementById('remoteUrl').textContent = info.remotes[0]?.url || 'none';
        document.getElementById('repoDetails').style.display = 'block';
        
        await refreshAll();
        showNotification('Repository loaded successfully', 'success');
    } catch (err) {
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// Refresh All Data
async function refreshAll() {
    await Promise.all([
        loadBranches(),
        loadStatus(),
        loadCommits()
    ]);
}

// Load Branches
async function loadBranches() {
    try {
        const data = await apiCall('/branches');
        const branchList = document.getElementById('branchList');
        branchList.innerHTML = '';
        
        // Local branches
        data.local.forEach(branch => {
            const div = document.createElement('div');
            div.className = 'branch-item' + (branch === data.current ? ' active' : '');
            div.innerHTML = `
                <span class="branch-name" onclick="checkoutBranch('${branch}')">${branch}</span>
                ${branch !== data.current ? `<button class="delete-btn" onclick="deleteBranch('${branch}')">×</button>` : ''}
            `;
            branchList.appendChild(div);
        });
        
        // Remote branches
        if (data.remote.length > 0) {
            const separator = document.createElement('div');
            separator.className = 'branch-separator';
            separator.textContent = 'Remote Branches';
            branchList.appendChild(separator);
            
            data.remote.forEach(branch => {
                const div = document.createElement('div');
                div.className = 'branch-item remote';
                div.innerHTML = `<span class="branch-name">${branch}</span>`;
                branchList.appendChild(div);
            });
        }
    } catch (err) {
        showNotification(`Error loading branches: ${err.message}`, 'error');
    }
}

// Load Status
async function loadStatus() {
    try {
        const status = await apiCall('/status');
        const statusList = document.getElementById('statusList');
        statusList.innerHTML = '';
        
        const allFiles = [
            ...status.modified.map(f => ({ file: f, status: 'modified' })),
            ...status.added.map(f => ({ file: f, status: 'added' })),
            ...status.deleted.map(f => ({ file: f, status: 'deleted' })),
            ...status.untracked.map(f => ({ file: f, status: 'untracked' }))
        ];
        
        if (allFiles.length === 0) {
            statusList.innerHTML = '<div class="no-changes">No changes</div>';
            return;
        }
        
        allFiles.forEach(({ file, status }) => {
            const div = document.createElement('div');
            div.className = `status-item status-${status}`;
            div.innerHTML = `
                <span class="status-badge">${status.charAt(0).toUpperCase()}</span>
                <span class="file-name">${file}</span>
                ${status === 'untracked' || status === 'modified' 
                    ? `<button onclick="stageFile('${file}')">Stage</button>` 
                    : `<button onclick="unstageFile('${file}')">Unstage</button>`}
            `;
            statusList.appendChild(div);
        });
    } catch (err) {
        showNotification(`Error loading status: ${err.message}`, 'error');
    }
}

// Load Commits
async function loadCommits() {
    try {
        const depth = parseInt(document.getElementById('logDepth').value) || 50;
        const data = await apiCall('/log', { depth });
        renderCommitGraph(data.commits);
    } catch (err) {
        showNotification(`Error loading commits: ${err.message}`, 'error');
    }
}

// Render Commit Graph with proper branch visualization
function renderCommitGraph(commits) {
    const graph = document.getElementById('commitGraph');
    graph.innerHTML = '';

    if (commits.length === 0) {
        graph.innerHTML = '<div class="no-commits">No commits yet</div>';
        return;
    }

    // Build graph structure with lanes for branch visualization
    const graphData = buildGraphLanes(commits);

    graphData.forEach((item, index) => {
        const commit = item.commit;
        const commitDiv = document.createElement('div');
        commitDiv.className = 'commit-node';
        commitDiv.onclick = () => showCommitDetails(commit.oid);

        const date = new Date(commit.author.timestamp * 1000);
        const dateStr = date.toLocaleString();

        // Combine local branches with their tracking remotes
        const branchTags = [];

        // Add local branches
        if (commit.branches && commit.branches.length > 0) {
            commit.branches.forEach(branch => {
                branchTags.push(`<span class="branch-tag branch-local">${escapeHtml(branch)}</span>`);
            });
        }

        // Add remote branches
        if (commit.remoteBranches && commit.remoteBranches.length > 0) {
            commit.remoteBranches.forEach(remoteBranch => {
                branchTags.push(`<span class="branch-tag branch-remote">${escapeHtml(remoteBranch)}</span>`);
            });
        }

        const branches = branchTags.length > 0
            ? `<div class="commit-branches">${branchTags.join('')}</div>`
            : '';

        // Build the graph visualization (lanes and connections)
        const graphViz = buildGraphVisualization(item, index, graphData);

        commitDiv.innerHTML = `
            <div class="commit-line">
                ${graphViz}
                <div class="commit-info">
                    <div class="commit-message">${escapeHtml(commit.message.split('\n')[0])}</div>
                    ${branches}
                    <div class="commit-meta">
                        <span class="commit-author">${escapeHtml(commit.author.name)}</span>
                        <span class="commit-date">${dateStr}</span>
                        <span class="commit-sha">${commit.oid.substring(0, 7)}</span>
                    </div>
                </div>
            </div>
        `;

        graph.appendChild(commitDiv);
    });
}

// Build lane structure for graph visualization
function buildGraphLanes(commits) {
    if (commits.length === 0) return [];

    // Map from commit OID to its index in the array
    const commitIndexMap = new Map();
    commits.forEach((commit, index) => {
        commitIndexMap.set(commit.oid, index);
    });

    // Track which lanes are "active" (have a commit expecting a parent below)
    // Each active lane tracks which commit OID it's waiting for
    const activeLanes = []; // Array of { expectingOid: string } or null for free lanes
    const commitLaneMap = new Map(); // OID -> lane number

    commits.forEach((commit, index) => {
        let assignedLane = -1;

        // Check if this commit is expected by any active lane
        for (let laneIdx = 0; laneIdx < activeLanes.length; laneIdx++) {
            if (activeLanes[laneIdx] && activeLanes[laneIdx].expectingOid === commit.oid) {
                assignedLane = laneIdx;
                break;
            }
        }

        // If not expected by any lane, find or create a free lane
        if (assignedLane === -1) {
            // Look for a free lane (null)
            for (let laneIdx = 0; laneIdx < activeLanes.length; laneIdx++) {
                if (activeLanes[laneIdx] === null) {
                    assignedLane = laneIdx;
                    break;
                }
            }
            // No free lane, create a new one
            if (assignedLane === -1) {
                assignedLane = activeLanes.length;
                activeLanes.push(null);
            }
        }

        // Assign this commit to the lane
        commitLaneMap.set(commit.oid, assignedLane);
        commits[index].lane = assignedLane;

        // Now handle parents
        const parents = commit.parents || [];

        if (parents.length === 0) {
            // No parents - this lane ends (root commit)
            activeLanes[assignedLane] = null;
        } else if (parents.length === 1) {
            // Single parent - continue on the same lane
            const parentOid = parents[0];
            // Check if parent exists in our commit list
            if (commitIndexMap.has(parentOid)) {
                activeLanes[assignedLane] = { expectingOid: parentOid };
            } else {
                // Parent not in our list, lane ends
                activeLanes[assignedLane] = null;
            }
        } else {
            // Multiple parents (merge commit)
            // First parent continues on the same lane
            const firstParent = parents[0];
            if (commitIndexMap.has(firstParent)) {
                activeLanes[assignedLane] = { expectingOid: firstParent };
            } else {
                activeLanes[assignedLane] = null;
            }

            // Other parents get new lanes (or reuse free ones)
            for (let p = 1; p < parents.length; p++) {
                const parentOid = parents[p];
                if (!commitIndexMap.has(parentOid)) continue;

                // Check if this parent is already expected by another lane
                let alreadyExpected = false;
                for (let laneIdx = 0; laneIdx < activeLanes.length; laneIdx++) {
                    if (activeLanes[laneIdx] && activeLanes[laneIdx].expectingOid === parentOid) {
                        alreadyExpected = true;
                        break;
                    }
                }

                if (!alreadyExpected) {
                    // Find or create a lane for this parent
                    let parentLane = -1;
                    for (let laneIdx = 0; laneIdx < activeLanes.length; laneIdx++) {
                        if (activeLanes[laneIdx] === null) {
                            parentLane = laneIdx;
                            break;
                        }
                    }
                    if (parentLane === -1) {
                        parentLane = activeLanes.length;
                        activeLanes.push(null);
                    }
                    activeLanes[parentLane] = { expectingOid: parentOid };
                }
            }
        }
    });

    // Calculate the max lane count
    const maxLane = Math.max(...commits.map(c => c.lane), 0);

    return commits.map((commit, index) => ({
        commit,
        lane: commit.lane,
        laneCount: maxLane + 1,
        parents: commit.parents || [],
        nextCommit: index < commits.length - 1 ? commits[index + 1] : null
    }));
}

// Build SVG visualization for graph lanes
function buildGraphVisualization(item, index, graphData) {
    const laneWidth = 20;
    const dotRadius = 6;
    const svgHeight = 50;
    const totalWidth = Math.max(item.laneCount, 1) * laneWidth + 20;
    const centerY = svgHeight / 2;

    const colors = ['#007acc', '#89d185', '#e2c08d', '#f48771', '#c586c0', '#4ec9b0', '#ce9178'];
    const color = colors[item.lane % colors.length];

    let svg = `<svg class="graph-canvas" width="${totalWidth}" height="${svgHeight}" style="min-width: ${totalWidth}px;">`;

    // Build a map of which lanes have commits coming from above (children pointing to us)
    // and which lanes continue below (we point to parents)
    const lanesFromAbove = new Set();
    const lanesGoingBelow = new Set();

    // Check previous commits (children) to see if they point to this commit
    for (let i = 0; i < index; i++) {
        const prevItem = graphData[i];
        if (prevItem.parents.includes(item.commit.oid)) {
            lanesFromAbove.add(prevItem.lane);
        }
    }

    // Check our parents to see which lanes we connect to below
    if (item.parents && item.parents.length > 0) {
        item.parents.forEach(parentOid => {
            const parentIndex = graphData.findIndex(d => d.commit.oid === parentOid);
            if (parentIndex > index) {
                lanesGoingBelow.add(graphData[parentIndex].lane);
            }
        });
    }

    // Draw vertical lines for lanes that pass through this row (not our lane)
    for (let laneIdx = 0; laneIdx < item.laneCount; laneIdx++) {
        if (laneIdx === item.lane) continue; // Skip our lane, handled separately

        const laneX = laneIdx * laneWidth + laneWidth / 2;
        const laneColor = colors[laneIdx % colors.length];

        // Check if this lane has activity passing through
        const comesFromAbove = lanesFromAbove.has(laneIdx);
        const goesBelow = lanesGoingBelow.has(laneIdx);

        // Also check if there's a commit below on this lane that we're not connected to
        let continuesBelow = false;
        for (let j = index + 1; j < graphData.length; j++) {
            if (graphData[j].lane === laneIdx) {
                // Check if any commit above connects to this one
                for (let k = 0; k <= index; k++) {
                    if (graphData[k].parents.includes(graphData[j].commit.oid)) {
                        continuesBelow = true;
                        break;
                    }
                }
                break;
            }
        }

        if (comesFromAbove || goesBelow || continuesBelow) {
            svg += `<line x1="${laneX}" y1="0" x2="${laneX}" y2="${svgHeight}" stroke="${laneColor}" stroke-width="2" />`;
        }
    }

    // Draw line from above to our commit (if there's a child pointing to us on same lane)
    if (lanesFromAbove.has(item.lane) || index > 0) {
        // Check if previous commit on our lane points to us
        let hasConnectionFromAbove = false;
        for (let i = 0; i < index; i++) {
            if (graphData[i].lane === item.lane && graphData[i].parents.includes(item.commit.oid)) {
                hasConnectionFromAbove = true;
                break;
            }
        }
        if (hasConnectionFromAbove) {
            const x = item.lane * laneWidth + laneWidth / 2;
            svg += `<line x1="${x}" y1="0" x2="${x}" y2="${centerY - dotRadius}" stroke="${color}" stroke-width="2" />`;
        }
    }

    // Draw lines to parents below
    if (item.parents && item.parents.length > 0) {
        item.parents.forEach(parentOid => {
            const parentIndex = graphData.findIndex(d => d.commit.oid === parentOid);
            if (parentIndex > index) {
                const parentLane = graphData[parentIndex].lane;
                const x1 = item.lane * laneWidth + laneWidth / 2;
                const x2 = parentLane * laneWidth + laneWidth / 2;
                const parentColor = colors[parentLane % colors.length];

                if (parentLane === item.lane) {
                    // Same lane - straight line down
                    svg += `<line x1="${x1}" y1="${centerY + dotRadius}" x2="${x2}" y2="${svgHeight}" stroke="${color}" stroke-width="2" />`;
                } else {
                    // Different lane - draw a curved/angled line
                    svg += `<path d="M ${x1} ${centerY + dotRadius} Q ${x1} ${svgHeight - 5} ${x2} ${svgHeight}" stroke="${parentColor}" stroke-width="2" fill="none" />`;
                }
            }
        });
    }

    // Draw the commit dot
    const x = item.lane * laneWidth + laneWidth / 2;
    svg += `<circle cx="${x}" cy="${centerY}" r="${dotRadius}" fill="${color}" stroke="#1e1e1e" stroke-width="2" />`;

    svg += '</svg>';

    return svg;
}

// Stage File
async function stageFile(filepath) {
    try {
        await apiCall('/add', { filepath });
        await loadStatus();
        showNotification(`Staged: ${filepath}`, 'success');
    } catch (err) {
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// Unstage File
async function unstageFile(filepath) {
    try {
        await apiCall('/reset', { filepath });
        await loadStatus();
        showNotification(`Unstaged: ${filepath}`, 'success');
    } catch (err) {
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// Commit Changes
async function commitChanges() {
    const message = document.getElementById('commitMessage').value.trim();
    if (!message) {
        alert('Please enter a commit message');
        return;
    }
    
    if (!authorConfig.name || !authorConfig.email) {
        showDialog('authorDialog');
        return;
    }
    
    try {
        await apiCall('/commit', { 
            message, 
            author: authorConfig 
        });
        document.getElementById('commitMessage').value = '';
        await refreshAll();
        showNotification('Committed successfully', 'success');
    } catch (err) {
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// Checkout Branch
async function checkoutBranch(branch) {
    try {
        await apiCall('/branch/checkout', { branchName: branch });
        await refreshAll();
        showNotification(`Switched to branch: ${branch}`, 'success');
    } catch (err) {
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// Create Branch
function showCreateBranchDialog() {
    showDialog('createBranchDialog');
}

async function createBranch() {
    const branchName = document.getElementById('newBranchName').value.trim();
    const checkout = document.getElementById('checkoutNewBranch').checked;
    
    if (!branchName) {
        alert('Please enter a branch name');
        return;
    }
    
    try {
        await apiCall('/branch/create', { branchName, checkout });
        closeDialog('createBranchDialog');
        document.getElementById('newBranchName').value = '';
        await refreshAll();
        showNotification(`Branch created: ${branchName}`, 'success');
    } catch (err) {
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// Delete Branch
async function deleteBranch(branch) {
    if (!confirm(`Delete branch "${branch}"?`)) return;
    
    try {
        await apiCall('/branch/delete', { branchName: branch });
        await loadBranches();
        showNotification(`Branch deleted: ${branch}`, 'success');
    } catch (err) {
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// Merge Branch
function showMergeDialog() {
    apiCall('/branches').then(data => {
        const select = document.getElementById('mergeBranchSelect');
        select.innerHTML = '';
        
        data.local.forEach(branch => {
            if (branch !== data.current) {
                const option = document.createElement('option');
                option.value = branch;
                option.textContent = branch;
                select.appendChild(option);
            }
        });
        
        showDialog('mergeDialog');
    });
}

async function mergeBranch() {
    const theirBranch = document.getElementById('mergeBranchSelect').value;
    
    if (!theirBranch) {
        alert('Please select a branch to merge');
        return;
    }
    
    try {
        await apiCall('/merge', { theirBranch });
        closeDialog('mergeDialog');
        await refreshAll();
        showNotification(`Merged ${theirBranch} successfully`, 'success');
    } catch (err) {
        if (err.message.includes('conflict')) {
            showNotification('Merge conflicts detected. Please resolve manually.', 'warning');
        } else {
            showNotification(`Error: ${err.message}`, 'error');
        }
    }
}

// Fetch
async function fetchRemote() {
    try {
        await apiCall('/fetch');
        await refreshAll();
        showNotification('Fetched from remote', 'success');
    } catch (err) {
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// Pull
async function pullChanges() {
    try {
        await apiCall('/pull');
        await refreshAll();
        showNotification('Pulled successfully', 'success');
    } catch (err) {
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// Push
async function pushChanges() {
    try {
        await apiCall('/push');
        await refreshAll();
        showNotification('Pushed successfully', 'success');
    } catch (err) {
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// Clone Repository
function showCloneDialog() {
    showDialog('cloneDialog');
}

async function cloneRepo() {
    const url = document.getElementById('cloneUrl').value.trim();
    const dir = document.getElementById('cloneDir').value.trim();
    const username = document.getElementById('cloneUsername').value.trim();
    const password = document.getElementById('clonePassword').value.trim();
    
    if (!url || !dir) {
        alert('Please enter URL and directory');
        return;
    }
    
    const credentials = username && password ? { username, password } : null;
    
    try {
        showNotification('Cloning repository...', 'info');
        await fetch('/api/clone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, dir, credentials })
        }).then(r => r.json());
        
        closeDialog('cloneDialog');
        document.getElementById('repoPath').value = dir;
        await loadRepo();
        showNotification('Repository cloned successfully', 'success');
    } catch (err) {
        showNotification(`Error: ${err.message}`, 'error');
    }
}

// Author Config
function saveAuthor() {
    const name = document.getElementById('authorName').value.trim();
    const email = document.getElementById('authorEmail').value.trim();
    
    if (!name || !email) {
        alert('Please enter name and email');
        return;
    }
    
    authorConfig = { name, email };
    localStorage.setItem('git.author.name', name);
    localStorage.setItem('git.author.email', email);
    
    closeDialog('authorDialog');
    showNotification('Author configuration saved', 'success');
}

// Dialog Helpers
function showDialog(id) {
    document.getElementById(id).style.display = 'flex';
}

function closeDialog(id) {
    document.getElementById(id).style.display = 'none';
}

// Notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Utility
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show Commit Details
async function showCommitDetails(oid) {
    try {
        const data = await apiCall('/commit-details', { oid });

        // Populate the modal
        document.getElementById('detailSha').textContent = data.oid;
        document.getElementById('detailAuthor').textContent =
            `${escapeHtml(data.author.name)} <${escapeHtml(data.author.email)}>`;

        const date = new Date(data.author.timestamp * 1000);
        document.getElementById('detailDate').textContent = date.toLocaleString();

        document.getElementById('detailMessage').textContent = data.message;

        // Build files list
        const filesList = document.getElementById('detailFiles');
        filesList.innerHTML = '';

        if (data.files.length === 0) {
            filesList.innerHTML = '<div class="no-changes">No file changes</div>';
        } else {
            data.files.forEach(file => {
                const div = document.createElement('div');
                div.className = 'file-item';
                const statusLetter = file.status.charAt(0).toUpperCase();
                div.innerHTML = `
                    <span class="file-status status-${file.status}">${statusLetter}</span>
                    <span class="file-path">${escapeHtml(file.filepath)}</span>
                `;
                filesList.appendChild(div);
            });
        }

        showDialog('commitDetailsDialog');
    } catch (err) {
        showNotification(`Error loading commit details: ${err.message}`, 'error');
    }
}

// Initialize
if (authorConfig.name && authorConfig.email) {
    document.getElementById('authorName').value = authorConfig.name;
    document.getElementById('authorEmail').value = authorConfig.email;
}
