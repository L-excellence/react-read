import { beginWork } from './ReactFiberBeginWork';
import { completeUnitOfWork } from './completeUnitOfWork';
import { commitRoot } from './commitRoot';

let Scheduler_now = null;
if (performance === 'object' && typeof performance.now === 'function') {
    const localPerformance = performance; // window.performance访问web应用程序性能
    Scheduler_now = () => localPerformance.now(); // now返回页面navigationStart触发(页面挂载时)和现在时间之间的毫秒数
} else {
    const localDate = Date;
    const initialTime = localDate.now();
    getCurrentTime = () => localDate.now() - initialTime;
}

const initialTimeMs = Scheduler_now();
const now = initialTimeMs < 10000 ? Scheduler_now : () => Scheduler_now() - initialTimeMs;

const ContextOnlyDispatcher = {
    readContext, // 用于读取上下文，内部是在dev环境给出console.err提示

    useCallback: throwInvalidHookError, // 错误警告，避免hooks在非函数组件中使用
    useContext: throwInvalidHookError,
    useEffect: throwInvalidHookError,
    useImperativeHandle: throwInvalidHookError,
    useLayoutEffect: throwInvalidHookError,
    useMemo: throwInvalidHookError,
    useReducer: throwInvalidHookError,
    useRef: throwInvalidHookError,
    useState: throwInvalidHookError,
    useDebugValue: throwInvalidHookError,
    useDeferredValue: throwInvalidHookError,
    useTransition: throwInvalidHookError,
    useMutableSource: throwInvalidHookError,
    useOpaqueIdentifier: throwInvalidHookError,

    unstable_isNewReconciler: enableNewReconciler, // true
};

function requestEventTime() {
    if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
        return now();
    }
    if (currentEventTime !== NoTimestamp) {
        return currentEventTime;
    }
    currentEventTime = now(); // 初次渲染返回最新time
    return currentEventTime;
}

function requestCurrentSuspenseConfig() {
    // 这个值是React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED中的一个属性
    const ReactCurrentBatchConfig = { suspense: null };
    return ReactCurrentBatchConfig.suspense;
    
}

function requestUpdateLane(fibe, suspenseConfig) {
    const mode = fiber.mode;
    if ((mode & BlockingMode) === NoMode) {
        return SyncLane;
    } else {
        // TODO...
    }
}

function createUpdate(eventTime, lane, suspenseConfig) {
    var update = {
        eventTime: eventTime,
        lane: lane,
        suspenseConfig: suspenseConfig,
        tag: UpdateState, // 0
        payload: null,
        callback: null,
        next: null
    };
    return update;
}

function enqueueUpdate(fiber, update) {
    var updateQueue = fiber.updateQueue;
    if (updateQueue === null) {
        return;
    }
    const sharedQueue = updateQueue.shared;
    const pending = sharedQueue.pending;
    if (pending === null) {
        update.next = update;
    } else {
        update.next = pending.next;
        pending.next = update;
    }
    sharedQueue.pending = update;
}

function checkForNestedUpdates() {
    if (nestedUpdateCount > NESTED_UPDATE_LIMIT) { // 大于50，报错
        nestedUpdateCount = 0;
        rootWithNestedUpdates = null;
        invariant(false, 'error');
    }
}

function markUpdateLaneFromFiberToRoot(sourceFiber, lane) {
    sourceFiber.lanes = mergeLanes(sourceFiber.lanes, lane);
    let alternate = sourceFiber.alternate;
    if (alternate !== null) {
        alternate.lanes = mergeLanes(alternate.lanes, lane);
    }
    let node = sourceFiber;
    let parent = sourceFiber.return;
    while (parent !== null) {
        parent.childLanes = mergeLanes(parent.childLanes, lane);
        alternate = parent.alternate;
        if (alternate !== null) {
            alternate.childLanes = mergeLanes(alternate.childLanes, lane);
        }
        node = parent;
        parent = parent.return;
    }
    if (node.tag === HostRoot) {
        const root = node.stateNode;
        return root;
    } else {
        return null;
    }
}

function markRootUpdated(root, updateLane, eventTime) {
    root.pendingLanes |= updateLane;
    const higherPriorityLanes = updateLane - 1;
    root.suspendedLanes &= higherPriorityLanes;
    root.pingedLanes &= higherPriorityLanes;
    const eventTimes = root.eventTimes;
    const index = laneToIndex(updateLane);
    eventTimes[index] = eventTime;
}

function pushDispatcher() {
    const prevDispatcher = ReactCurrentDispatcher.current; // ReactAPI中的一个属性，初始值为null
    ReactCurrentDispatcher.current = ContextOnlyDispatcher;
    if (prevDispatcher === null) {
        return ContextOnlyDispatcher;
    } else {
        return prevDispatcher;
    }
}

function createWorkInProgress(current, pendingProps) {
    let workInProgress = current.alternate;
    if (workInProgress === null) {
        workInProgress = createFiber(current.tag, pendingProps, current.key, current.mode);
        workInProgress.elementType = current.elementType;
        workInProgress.type = current.type;
        workInProgress.stateNode = current.stateNode;

        workInProgress.alternate = current;
        current.alternate = workInProgress;
    } else {
        workInProgress.pendingProps = pendingProps;
        workInProgress.type = current.type;
        workInProgress.subtreeTag = NoSubtreeEffect;
        workInProgress.deletions = null;

        workInProgress.nextEffect = null;
        workInProgress.firstEffect = null;
        workInProgress.lastEffect = null;

        if (enableProfilerTimer) {
            workInProgress.actualDuration = 0;
            workInProgress.actualStartTime = -1;
        }
    }

    // Reset all effects except static ones.
    // Static effects are not specific to a render.
    workInProgress.effectTag = current.effectTag & StaticMask; // StaticMask=32768
    workInProgress.childLanes = current.childLanes;
    workInProgress.lanes = current.lanes;

    workInProgress.child = current.child;
    workInProgress.memoizedProps = current.memoizedProps;
    workInProgress.memoizedState = current.memoizedState;
    workInProgress.updateQueue = current.updateQueue;

    // Clone the dependencies object. This is mutated during the render phase, so
    // it cannot be shared with the current fiber.
    const currentDependencies = current.dependencies;
    workInProgress.dependencies =
        currentDependencies === null
            ? null
            : {
                lanes: currentDependencies.lanes,
                firstContext: currentDependencies.firstContext,
            };
    workInProgress.sibling = current.sibling;
    workInProgress.index = current.index;
    workInProgress.ref = current.ref;

    if (enableProfilerTimer) {
        workInProgress.selfBaseDuration = current.selfBaseDuration;
        workInProgress.treeBaseDuration = current.treeBaseDuration;
    }

    return workInProgress;
}

function prepareFreshStack(root, lanes) {
    root.finishedWork = null;
    root.finishedLanes = NoLanes;

    const timeoutHandle = root.timeoutHandle;
    if (timeoutHandle !== noTimeout) {
        root.timeoutHandle = noTimeout;
        cancelTimeout(timeoutHandle);
    }

    // 解除中断的工作
    if (workInProgress !== null) {
        let interruptedWork = workInProgress.return;
        while (interruptedWork !== null) {
            unwindInterruptedWork(interruptedWork);
            interruptedWork = interruptedWork.return;
        }
    }
    workInProgressRoot = root; // 当前工作执行的root
    workInProgress = createWorkInProgress(root.current, null); // 当前执行的fiber
    workInProgressRootRenderLanes = subtreeRenderLanes = workInProgressRootIncludedLanes = lanes;
    workInProgressRootExitStatus = RootIncomplete; // RootIncomplete=0
    workInProgressRootFatalError = null;
    workInProgressRootLatestSuspenseTimeout = NoTimestamp;
    workInProgressRootCanSuspendUsingConfig = null;
    workInProgressRootSkippedLanes = NoLanes;
    workInProgressRootUpdatedLanes = NoLanes;
    workInProgressRootPingedLanes = NoLanes;

    if (enableSchedulerTracing) {
        spawnedWorkDuringRender = null;
    }
}

function startWorkOnPendingInteractions(root, lanes) {
    // 变量控制，当在根上启动新工作时，才会调用该函数执行
    if (!enableSchedulerTracing) { // __PROFILE__
        return;
    }
    
    const interactions = new Set();
    root.pendingInteractionMap.forEach((scheduledInteractions, scheduledLane) => {
        if (includesSomeLane(lanes, scheduledLane)) {
            scheduledInteractions.forEach(interaction =>
                interactions.add(interaction),
            );
        }
    });

    root.memoizedInteractions = interactions;

    if (interactions.size > 0) {
        const subscriber = __subscriberRef.current;
        if (subscriber !== null) {
            const threadID = computeThreadID(root, lanes);
            try {
                subscriber.onWorkStarted(interactions, threadID);
            } catch (error) {
                // If the subscriber throws, rethrow it in a separate task
                scheduleCallback(ImmediateSchedulerPriority, () => {
                    throw error;
                });
            }
        }
    }
}

function pushInteractions(root) {
    if (enableSchedulerTracing) {
      const prevInteractions = __interactionsRef.current;
      __interactionsRef.current = root.memoizedInteractions;
      return prevInteractions;
    }
    return null;
}

function popInteractions(prevInteractions) {
    if (enableSchedulerTracing) {
        __interactionsRef.current = prevInteractions;
    }
}

function resetContextDependencies() {
    currentlyRenderingFiber = null;
    lastContextDependency = null;
    lastContextWithAllBitsObserved = null;
}

function performUnitOfWork(unitOfWork) {
    const current = unitOfWork.alternate;
    let next;
    if (enableProfilerTimer && (unitOfWork.mode & ProfileMode) !== NoMode) {
        startProfilerTimer(unitOfWork);
        next = beginWork(current, unitOfWork, subtreeRenderLanes);
        stopProfilerTimerIfRunningAndRecordDelta(unitOfWork, true);
    } else {
        next = beginWork(current, unitOfWork, subtreeRenderLanes); // 初次渲染执行这里
    }

    unitOfWork.memoizedProps = unitOfWork.pendingProps;
    if (next === null) {
        // If this doesn't spawn new work, complete the current work.
        completeUnitOfWork(unitOfWork);
    } else {
        workInProgress = next;
    }

    ReactCurrentOwner.current = null;
}

function workLoopSync() {
    while (workInProgress !== null) {
        performUnitOfWork(workInProgress);
    }
}

function renderRootSync(root, lanes) {
    const prevExecutionContext = executionContext;
    executionContext |= RenderContext; // 修改当前执行栈状态为Render
    var prevDispatcher = pushDispatcher();
    // 如果根或者lane已更改，则抛出现有的堆栈，准备新的堆栈；否则继续上次的工作
    if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
        prepareFreshStack(root, lanes);
        startWorkOnPendingInteractions(root, lanes);
    }
    // 更新Interactions，并返回上一次的Interactions
    const prevInteractions = pushInteractions(root);
    if (enableSchedulingProfiler) {
        markRenderStarted(lanes); // performance.mark('--render-yield');
    }

    do {
        try {
            workLoopSync(); // 核心，开始同步执行工作
            break; // 执行一次workLoopSync后跳出 do while
        } catch (thrownValue) {
            handleError(root, thrownValue);
        }
    } while (true);
    // 重置向下文依赖项
    resetContextDependencies();
    if (enableSchedulerTracing) {
        popInteractions(prevInteractions);
    }

    executionContext = prevExecutionContext;
    // 删除当前Interactions，并恢复初始Interactions
    popDispatcher(prevDispatcher);

    // 这是初次渲染，要保证整个树的节点都渲染完成，即workInProgress=null，若还存在节点，抛出错误。
    if (workInProgress !== null) {
        invariant(
            false,
            'Cannot commit an incomplete root. This error is likely caused by a ' +
            'bug in React. Please file an issue.',
        );
    }

    if (enableSchedulingProfiler) {
        markRenderStopped(); // performance.mark('--render-stop');
    }

    // 渲染完成后将当前工作的根设为null，表示工作完成
    workInProgressRoot = null;
    workInProgressRootRenderLanes = NoLanes;
    return workInProgressRootExitStatus; // 进行workLoopSync之前，这个值设置为0(RootIncomplete)，节点全部complete后值为5(RootCompleted)
}

function performSyncWorkOnRoot(root) {
    flushPassiveEffects(); // 初始化时该方法没有做任何处理
    let lanes;
    let exitStatus;
    if (root === workInProgressRoot && includesSomeLane(root.expiredLanes, workInProgressRootRenderLanes)) {
        // TODO...
    } else {
        lanes = getNextLanes(root, NoLanes);
        exitStatus = renderRootSync(root, lanes); // 核心
    }
    const finishedWork = root.current.alternate;
    root.finishedWork = finishedWork;
    root.finishedLanes = lanes;
    commitRoot(root);
    ensureRootIsScheduled(root, now());
    return null;
}

function scheduleUpdateOnFiber(fiber, lane, eventTime) {
    checkForNestedUpdates();
    const root = markUpdateLaneFromFiberToRoot(fiber, lane);
    if (root === null) {
        return null;
    }
    markRootUpdated(root, lane, eventTime);
    if (root === workInProgressRoot) {
        // TODO...
    }
    const priorityLevel = getCurrentPriorityLevel();
    if (lane === SyncLane) {
        if (
            // Check if we're inside unbatchedUpdates
            (executionContext & LegacyUnbatchedContext) !== NoContext &&
            // Check if we're not already rendering
            (executionContext & (RenderContext | CommitContext)) === NoContext
        ) {
            // Register pending interactions on the root to avoid losing traced interaction data.
            schedulePendingInteractions(root, lane); // 初次渲染这个方法内部不满足代码执行条件
            performSyncWorkOnRoot(root); // 核心
        } else {
            // TODO...
        }
    } else {
        // TODO...
    }
}

export function updateContainer(element, container, parentComponent, callback) {
    const current = container.current;
    const eventTime = requestEventTime();
    const suspenseConfig = requestCurrentSuspenseConfig();
    const lane = requestUpdateLane(current, suspenseConfig);
    const context = getContextForSubtree(parentComponent); // {}
    if (container.context === null) {
        container.context = context;
    } else {
        container.pendingContext = context;
    }
    const update = createUpdate(eventTime, lane, suspenseConfig);
    update.payload = { element };
    callback = callback === undefined ? null : callback;
    if (callback !== null) {
        update.callback = callback;
    }
    enqueueUpdate(current, update);
    scheduleUpdateOnFiber(current, lane, eventTime);
    return lane;
} 


export function unbatchedUpdates(fn, a) {
    const prevExecutionContext = executionContext;
    executionContext &= ~BatchedContext;
    executionContext |= LegacyUnbatchedContext;
    try {
        return fn(a); // 执行updateContainer
    } finally {
        // TODO... 
        // executionContext = prevExecutionContext;
        // if (executionContext === NoContext) {
        //     flushSyncCallbackQueue();
        // }
    }
};

