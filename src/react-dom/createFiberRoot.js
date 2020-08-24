const ROOT_ATTRIBUTE_NAME = 'data-reactroot';
const randomKey = Math.random().toString(36).slice(2);
const internalContainerInstanceKey = '__reactContainer$' + randomKey;

function getReactRootElementInContainer(container) {
    if (!container) {
        return null;
    }
    if (container.nodeType === DOCUMENT_NODE) {
        return container.documentElement;
    } else {
        return container.firstChild;
    }
}

// 查找container.firstChild是否存在data-reactroot属性
function shouldHydrateDueToLegacyHeuristic(container) {
    const rootElement = getReactRootElementInContainer(container);
    return !!(
        rootElement &&
        rootElement.nodeType === ELEMENT_NODE && // ELEMENT_NODE = 1
        rootElement.hasAttribute(ROOT_ATTRIBUTE_NAME)
    );
}

function FiberRootNode(containerInfo, tag, hydrate) {
    this.tag = tag;
    this.containerInfo = containerInfo;
    this.pendingChildren = null;
    this.current = null;
    this.pingCache = null;
    this.finishedWork = null;
    this.timeoutHandle = noTimeout;
    this.context = null;
    this.pendingContext = null;
    this.hydrate = hydrate;
    this.callbackNode = null;
    this.callbackPriority = NoLanePriority;
    this.eventTimes = createLaneMap(NoLanes);
    this.expirationTimes = createLaneMap(NoTimestamp);

    this.pendingLanes = NoLanes;
    this.suspendedLanes = NoLanes;
    this.pingedLanes = NoLanes;
    this.expiredLanes = NoLanes;
    this.mutableReadLanes = NoLanes;
    this.finishedLanes = NoLanes;

    this.entangledLanes = NoLanes;
    this.entanglements = createLaneMap(NoLanes);

    if (supportsHydration) {
        this.mutableSourceEagerHydrationData = null;
    }

    if (enableSchedulerTracing) {
        this.interactionThreadID = unstable_getThreadID();
        this.memoizedInteractions = new Set();
        this.pendingInteractionMap = new Map();
    }
    if (enableSuspenseCallback) {
        this.hydrationCallbacks = null;
    }
}

function FiberNode(tag, pendingProps, key, mode) {
    // Instance
    this.tag = tag;
    this.key = key;
    this.elementType = null;
    this.type = null;
    this.stateNode = null;

    // Fiber
    this.return = null;
    this.child = null;
    this.sibling = null;
    this.index = 0;

    this.ref = null;

    this.pendingProps = pendingProps;
    this.memoizedProps = null;
    this.updateQueue = null;
    this.memoizedState = null;
    this.dependencies = null;

    this.mode = mode;

    // Effects
    this.effectTag = NoEffect;
    this.nextEffect = null;

    this.firstEffect = null;
    this.lastEffect = null;

    this.lanes = NoLanes;
    this.childLanes = NoLanes;

    this.alternate = null;
}

function createFiber(tag, pendingProps, key, mode) {
    return new FiberNode(tag, pendingProps, key, mode);
}

function createHostRootFiber(tag) {
    let mode;
    if (tag === ConcurrentRoot) {
        mode = ConcurrentMode | BlockingMode | StrictMode;
    } else if (tag === BlockingRoot) {
        mode = BlockingMode | StrictMode;
    } else {
        mode = NoMode;
    }
    return createFiber(HostRoot, null, null, mode); // HostRoot = 3
}

function initializeUpdateQueue(fiber) {
    const queue = {
        baseState: fiber.memoizedState,
        firstBaseUpdate: null,
        lastBaseUpdate: null,
        shared: {
            pending: null,
        },
        effects: null,
    };
    fiber.updateQueue = queue;
}

function createFiberRoot(containerInfo, tag, hydrate, hydrationCallbacks) {
    // 创建FiberRootNode节点，这个是描述全局唯一的fiber根树
    const root = new FiberRootNode(containerInfo, tag, hydrate);
    if (enableSuspenseCallback) { // false
        root.hydrationCallbacks = hydrationCallbacks;
    }
    // 创建FiberRootNode对应的rootFiber节点，这个是描述element DOM节点对应的fiber
    const uninitializedFiber = createHostRootFiber(tag);
    // 两者建立关系
    root.current = uninitializedFiber;
    uninitializedFiber.stateNode = root;
    // 初始化当前fiber节点的更新队列
    initializeUpdateQueue(uninitializedFiber);
    return root;
}

function createContainer(containerInfo, tag, hydrate, hydrationCallbacks) {
    return createFiberRoot(containerInfo, tag, hydrate, hydrationCallbacks);
}

function markContainerAsRoot(hostRoot, node) {
    node[internalContainerInstanceKey] = hostRoot;
}

function createRootImpl(container, tag, options) {
    const hydrate = options != null && options.hydrate === true;
    const hydrationCallbacks = (options != null && options.hydrationOptions) || null;
    // 创建FiberRootNode
    const root = createContainer(container, tag, hydrate, hydrationCallbacks);
    markContainerAsRoot(root.current, container);
    const containerNodeType = container.nodeType;
    if (hydrate && tag !== LegacyRoot) {
        // TODO... React.render不考虑 hydrate
    } else if (containerNodeType !== DOCUMENT_FRAGMENT_NODE && containerNodeType !== DOCUMENT_NODE) {
        ensureListeningTo(container, 'onMouseEnter', null);
    }
    return root;
}

function ReactDOMBlockingRoot(container, tag, options) {
    this._internalRoot = createRootImpl(container, tag, options);
}

function createLegacyRoot(container, options) {
    return new ReactDOMBlockingRoot(container, LegacyRoot, options); // LegacyRoot = 0，传统的渲染方式
}

export function legacyCreateRootFromDOMContainer(container, forceHydrate) {
    const shouldHydrate = forceHydrate || shouldHydrateDueToLegacyHeuristic(container); // false
    if (!shouldHydrate) { // 不需要复用原有根节点结构，移除所有子节点（hydrate模式下会复用起HTML结构）
        let rootSibling;
        while ((rootSibling = container.lastChild)) {
            container.removeChild(rootSibling);
        }
    }
    return createLegacyRoot(container, shouldHydrate ? { hydrate: true } : undefined);
}