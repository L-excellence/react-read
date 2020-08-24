const ImmediateSchedulerPriority = 99;
const SyncLanePriority = 17;


function reactPriorityToSchedulerPriority(reactPriorityLevel) {
    switch (reactPriorityLevel) {
        case ImmediatePriority:
            return Scheduler_ImmediatePriority;
        case UserBlockingPriority:
            return Scheduler_UserBlockingPriority;
        case NormalPriority:
            return Scheduler_NormalPriority;
        case LowPriority:
            return Scheduler_LowPriority;
        case IdlePriority:
            return Scheduler_IdlePriority;
        default:
            invariant(false, 'Unknown priority level.');
    }
}

function Scheduler_runWithPriority(priorityLevel, eventHandler) {
    switch (priorityLevel) {
        case ImmediatePriority:
        case UserBlockingPriority:
        case NormalPriority:
        case LowPriority:
        case IdlePriority:
            break;
        default:
            priorityLevel = NormalPriority;
    }

    var previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = priorityLevel;

    try {
        return eventHandler(); // 执行commitRootImpl
    } finally {
        currentPriorityLevel = previousPriorityLevel;
    }
}

function runWithPriority(reactPriorityLevel, fn) {
    const priorityLevel = reactPriorityToSchedulerPriority(reactPriorityLevel); // 返回1
    return Scheduler_runWithPriority(priorityLevel, fn);
}

function prepareForCommit(containerInfo) {
    eventsEnabled = ReactBrowserEventEmitterIsEnabled(); // true 获取全局变量_enabled：事件是否启用
    selectionInformation = getSelectionInformation(); // 返回一个对象，有一个属性 focusedElem 表示 document.activeElement（body）
    let activeInstance = null;
    ReactBrowserEventEmitterSetEnabled(false); // 设置_enabled事件启用状态为false
    return activeInstance; // 返回null
}

function commitRootImpl(root, renderPriorityLevel) {
    /** --------------- before mutation ----------------------------- */
    do {
        // 触发useEffect回调与其他同步任务。由于这些任务可能触发新的渲染，所以这里要一直遍历执行直到没有任务
        flushPassiveEffects();
    } while (rootWithPendingPassiveEffects !== null);

    // root.finishedWork指当前应用的rootFiber
    const finishedWork = root.finishedWork;
    const lanes = root.finishedLanes;

    if (finishedWork === null) {
        return null;
    }
    root.finishedWork = null;
    root.finishedLanes = NoLanes;
     // 重置Scheduler绑定的回调函数
    root.callbackNode = null;

    // 更新root的第一个和最后一个的挂起时间
    let remainingLanes = mergeLanes(finishedWork.lanes, finishedWork.childLanes);
    // 重置优先级相关变量
    markRootFinished(root, remainingLanes);

    // 清除已完成的离散更新。清除已完成的discrete updates，例如：用户鼠标点击触发的更新。
    if (rootsWithPendingDiscreteUpdates !== null) {
        if (!hasDiscreteLanes(remainingLanes) && rootsWithPendingDiscreteUpdates.has(root)) {
            rootsWithPendingDiscreteUpdates.delete(root);
        }
    }

    // 重置全局变量
    if (root === workInProgressRoot) {
        workInProgressRoot = null;
        workInProgress = null;
        workInProgressRootRenderLanes = NoLanes;
    }

    // 获取effectList
    let firstEffect;
    if (finishedWork.effectTag > PerformedWork) {
        // 列表规则：只包含子对象，不包含其自身，如果根节点上有effectTag，则将它添加到列表末尾。
        if (finishedWork.lastEffect !== null) {
            finishedWork.lastEffect.nextEffect = finishedWork;
            firstEffect = finishedWork.firstEffect;
        } else {
            firstEffect = finishedWork;
        }
    } else {
        // 根节点没有effectTag
        firstEffect = finishedWork.firstEffect;
    }

    if (firstEffect !== null) {
        // 保存当前的优先级，以同步优先级执行，执行完毕后恢复之前优先级
        let previousLanePriority = getCurrentUpdateLanePriority(); // 返回currentUpdateLanePriority
        setCurrentUpdateLanePriority(SyncLanePriority); // 设置currentUpdateLanePriority为SyncLanePriority（17）

        // 将当前上下文标记为CommitContext，作为commit阶段的标志
        const prevExecutionContext = executionContext;
        executionContext |= CommitContext;
        const prevInteractions = pushInteractions(root);
        ReactCurrentOwner.current = null;

        // 处理focus状态 准备提交
        focusedInstanceHandle = prepareForCommit(root.containerInfo);
        shouldFireAfterActiveInstanceBlur = false;  // 应在活动实例模糊后blur

        // beforeMutation阶段的主函数
        commitBeforeMutationEffects(finishedWork);

        // We no longer need to track the active instance fiber
        focusedInstanceHandle = null;

        if (enableProfilerTimer) {
            // Mark the current commit time to be shared by all Profilers in this
            // batch. This enables them to be grouped later.
            recordCommitTime();
        }

        // The next phase is the mutation phase, where we mutate the host tree.
        commitMutationEffects(finishedWork, root, renderPriorityLevel);

        if (shouldFireAfterActiveInstanceBlur) {
            afterActiveInstanceBlur();
        }
        resetAfterCommit(root.containerInfo);

        // The work-in-progress tree is now the current tree. This must come after
        // the mutation phase, so that the previous tree is still current during
        // componentWillUnmount, but before the layout phase, so that the finished
        // work is current during componentDidMount/Update.
        root.current = finishedWork;

        // The next phase is the layout phase, where we call effects that read
        // the host tree after it's been mutated. The idiomatic use case for this is
        // layout, but class component lifecycles also fire here for legacy reasons.

        if (__DEV__) {
            if (enableDebugTracing) {
                logLayoutEffectsStarted(lanes);
            }
        }
        if (enableSchedulingProfiler) {
            markLayoutEffectsStarted(lanes);
        }

        commitLayoutEffects(finishedWork, root, lanes);

        if (__DEV__) {
            if (enableDebugTracing) {
                logLayoutEffectsStopped();
            }
        }
        if (enableSchedulingProfiler) {
            markLayoutEffectsStopped();
        }

        // If there are pending passive effects, schedule a callback to process them.
        if (
            (finishedWork.subtreeTag & PassiveSubtreeTag) !== NoSubtreeTag ||
            (finishedWork.effectTag & PassiveMask) !== NoEffect
        ) {
            if (!rootDoesHavePassiveEffects) {
                rootDoesHavePassiveEffects = true;
                scheduleCallback(NormalSchedulerPriority, () => {
                    flushPassiveEffects();
                    return null;
                });
            }
        }

        // Tell Scheduler to yield at the end of the frame, so the browser has an
        // opportunity to paint.
        requestPaint();

        if (enableSchedulerTracing) {
            popInteractions(((prevInteractions: any): Set<Interaction>));
        }
        executionContext = prevExecutionContext;

        if (decoupleUpdatePriorityFromScheduler && previousLanePriority != null) {
            // Reset the priority to the previous non-sync value.
            setCurrentUpdateLanePriority(previousLanePriority);
        }
    } else {
        // No effects.
        root.current = finishedWork;
        // Measure these anyway so the flamegraph explicitly shows that there were
        // no effects.
        // TODO: Maybe there's a better way to report this.
        if (enableProfilerTimer) {
            recordCommitTime();
        }
    }

    const rootDidHavePassiveEffects = rootDoesHavePassiveEffects;

    if (rootDoesHavePassiveEffects) {
        // This commit has passive effects. Stash a reference to them. But don't
        // schedule a callback until after flushing layout work.
        rootDoesHavePassiveEffects = false;
        rootWithPendingPassiveEffects = root;
        pendingPassiveEffectsLanes = lanes;
        pendingPassiveEffectsRenderPriority = renderPriorityLevel;
    }

    // Read this again, since an effect might have updated it
    remainingLanes = root.pendingLanes;

    // Check if there's remaining work on this root
    if (remainingLanes !== NoLanes) {
        if (enableSchedulerTracing) {
            if (spawnedWorkDuringRender !== null) {
                const expirationTimes = spawnedWorkDuringRender;
                spawnedWorkDuringRender = null;
                for (let i = 0; i < expirationTimes.length; i++) {
                    scheduleInteractions(
                        root,
                        expirationTimes[i],
                        root.memoizedInteractions,
                    );
                }
            }
            schedulePendingInteractions(root, remainingLanes);
        }
    } else {
        // If there's no remaining work, we can clear the set of already failed
        // error boundaries.
        legacyErrorBoundariesThatAlreadyFailed = null;
    }

    if (enableSchedulerTracing) {
        if (!rootDidHavePassiveEffects) {
            // If there are no passive effects, then we can complete the pending interactions.
            // Otherwise, we'll wait until after the passive effects are flushed.
            // Wait to do this until after remaining work has been scheduled,
            // so that we don't prematurely signal complete for interactions when there's e.g. hidden work.
            finishPendingInteractions(root, lanes);
        }
    }

    if (remainingLanes === SyncLane) {
        // Count the number of times the root synchronously re-renders without
        // finishing. If there are too many, it indicates an infinite update loop.
        if (root === rootWithNestedUpdates) {
            nestedUpdateCount++;
        } else {
            nestedUpdateCount = 0;
            rootWithNestedUpdates = root;
        }
    } else {
        nestedUpdateCount = 0;
    }

    onCommitRootDevTools(finishedWork.stateNode, renderPriorityLevel);

    if (__DEV__) {
        onCommitRootTestSelector();
    }

    // Always call this before exiting `commitRoot`, to ensure that any
    // additional work on this root is scheduled.
    ensureRootIsScheduled(root, now());

    if (hasUncaughtError) {
        hasUncaughtError = false;
        const error = firstUncaughtError;
        firstUncaughtError = null;
        throw error;
    }

    if ((executionContext & LegacyUnbatchedContext) !== NoContext) {
        if (__DEV__) {
            if (enableDebugTracing) {
                logCommitStopped();
            }
        }

        if (enableSchedulingProfiler) {
            markCommitStopped();
        }

        // This is a legacy edge case. We just committed the initial mount of
        // a ReactDOM.render-ed root inside of batchedUpdates. The commit fired
        // synchronously, but layout updates should be deferred until the end
        // of the batch.
        return null;
    }

    // If layout work was scheduled, flush it now.
    flushSyncCallbackQueue();

    if (__DEV__) {
        if (enableDebugTracing) {
            logCommitStopped();
        }
    }

    if (enableSchedulingProfiler) {
        markCommitStopped();
    }

    return null;
}

export function commitRoot(root) {
    const renderPriorityLevel = getCurrentPriorityLevel(); // 初次渲染时拿到值是97
    runWithPriority(ImmediateSchedulerPriority, commitRootImpl.bind(null, root, renderPriorityLevel));
    return null;
}