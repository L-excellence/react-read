
let index = -1;
const valueStack = [];
let hasForceUpdate = false;

function createCursor(defaultValue) {
    return {
        current: defaultValue,
    };
}
const emptyContextObject = {};
const NO_CONTEXT = {};
const contextStackCursor = createCursor(emptyContextObject);
const didPerformWorkStackCursor = createCursor(false);
const rootInstanceStackCursor = createCursor(NO_CONTEXT);
const contextFiberStackCursor = createCursor(NO_CONTEXT);
const contextStackCursor = createCursor(NO_CONTEXT);
function pop(cursor, fiber) {
    if (index < 0) {
        return;
    }
    cursor.current = valueStack[index];
    valueStack[index] = null;
    index--;
}
function push(cursor, value, fiber) {
    index++;
    valueStack[index] = cursor.current;
    cursor.current = value;
}
function pushTopLevelContextObject(fiber, context, didChange) {
    if (disableLegacyContext) {
        return;
    } else {
        push(contextStackCursor, context, fiber);
        push(didPerformWorkStackCursor, didChange, fiber);
    }
}
function pushHostContainer(fiber, nextRootInstance) {
    push(rootInstanceStackCursor, nextRootInstance, fiber);
    push(contextFiberStackCursor, fiber, fiber);
    push(contextStackCursor, NO_CONTEXT, fiber);
    const nextRootContext = getRootHostContext(nextRootInstance);
    pop(contextStackCursor, fiber);
    push(contextStackCursor, nextRootContext, fiber);
  }

function pushHostRootContext(workInProgress) {
    const root = workInProgress.stateNode;
    if (root.pendingContext) {
        pushTopLevelContextObject(workInProgress, root.pendingContext, root.pendingContext !== root.context);
    } else if (root.context) {
        // Should always be set
        pushTopLevelContextObject(workInProgress, root.context, false); // 推送到顶层上下文对象
    }
    pushHostContainer(workInProgress, root.containerInfo);
}

function cloneUpdateQueue(current, workInProgress) {
    const queue = workInProgress.updateQueue;
    const currentQueue = current.updateQueue;
    if (queue === currentQueue) {
        const clone = {
            baseState: currentQueue.baseState,
            firstBaseUpdate: currentQueue.firstBaseUpdate,
            lastBaseUpdate: currentQueue.lastBaseUpdate,
            shared: currentQueue.shared,
            effects: currentQueue.effects,
        };
        workInProgress.updateQueue = clone;
    }
}

function getStateFromUpdate(workInProgress, queue, update, prevState, nextProps, instance) {
    switch (update.tag) {
        case ReplaceState: {
            const payload = update.payload;
            if (typeof payload === 'function') {
                // Updater function
                const nextState = payload.call(instance, prevState, nextProps);
                return nextState;
            }
            // State object
            return payload;
        }
        case CaptureUpdate: {
            workInProgress.effectTag = (workInProgress.effectTag & ~ShouldCapture) | DidCapture;
        }
        case UpdateState: {
            const payload = update.payload;
            let partialState;
            if (typeof payload === 'function') {
                // Updater function
                partialState = payload.call(instance, prevState, nextProps);
            } else {
                // Partial state object
                partialState = payload;
            }
            if (partialState === null || partialState === undefined) {
                // Null and undefined are treated as no-ops.
                return prevState;
            }
            // Merge the partial state and the previous state.
            return Object.assign({}, prevState, partialState);
        }
        case ForceUpdate: {
            hasForceUpdate = true;
            return prevState;
        }
    }
    return prevState;
}

// 处理workInProgress的updateQueue，并计算出memoizedState
function processUpdateQueue(workInProgress, props, instance, renderLanes) {
    const queue = workInProgress.updateQueue;
    hasForceUpdate = false;
  
    let firstBaseUpdate = queue.firstBaseUpdate; // 初次渲染时值是null
    let lastBaseUpdate = queue.lastBaseUpdate; // null
  
    // 检查是否有挂起的更新(shared.pending)，如果有，将它们转移到基本队列(执行更新的队列中)。
    let pendingQueue = queue.shared.pending;
    if (pendingQueue !== null) {
        queue.shared.pending = null; // 初始化
        const lastPendingUpdate = pendingQueue;
        const firstPendingUpdate = lastPendingUpdate.next;
        lastPendingUpdate.next = null;
        if (lastBaseUpdate === null) {
            firstBaseUpdate = firstPendingUpdate; // 将挂起的更新（queue.shared.pending）添加到 queue.firstBaseUpdate
        } else {
            lastBaseUpdate.next = firstPendingUpdate;
        }
        lastBaseUpdate = lastPendingUpdate; // 将挂起的更新（queue.shared.pending）添加到 queue.lastBaseUpdate

        const current = workInProgress.alternate;
        if (current !== null) { // current在 ClassComponent or HostRoot 中，不管是mount还是update，值总是存在
            const currentQueue = current.updateQueue;
            const currentLastBaseUpdate = currentQueue.lastBaseUpdate;
            if (currentLastBaseUpdate !== lastBaseUpdate) {
                if (currentLastBaseUpdate === null) {
                    currentQueue.firstBaseUpdate = firstPendingUpdate;
                } else {
                    currentLastBaseUpdate.next = firstPendingUpdate;
                }
                currentQueue.lastBaseUpdate = lastPendingUpdate;
            }
        }
    }

    if (firstBaseUpdate !== null) {
        let newState = queue.baseState; // 初始值时null
        let newLanes = NoLanes; // 移除lane（设置新的lane为初始值）
        let newBaseState = null;
        let newFirstBaseUpdate = null;
        let newLastBaseUpdate = null;
        let update = firstBaseUpdate;
        do {
            const updateLane = update.lane;
            const updateEventTime = update.eventTime;
            // 优先级不足，跳过此更新 (初次渲染不会进入到这里)
            if (!isSubsetOfLanes(renderLanes, updateLane)) { // renderLanes & updateLane === updateLane
                const clone = {
                    eventTime: updateEventTime,
                    lane: updateLane,
                    suspenseConfig: update.suspenseConfig,

                    tag: update.tag,
                    payload: update.payload,
                    callback: update.callback,

                    next: null,
                };
                if (newLastBaseUpdate === null) {
                    newFirstBaseUpdate = newLastBaseUpdate = clone;
                    newBaseState = newState;
                } else {
                    newLastBaseUpdate = newLastBaseUpdate.next = clone;
                }
                // Update the remaining priority in the queue.
                newLanes = mergeLanes(newLanes, updateLane);
            } else {
                // 此更新具有足够的优先级
                if (newLastBaseUpdate !== null) {
                    const clone = {
                        eventTime: updateEventTime,
                        lane: NoLane,
                        suspenseConfig: update.suspenseConfig,

                        tag: update.tag,
                        payload: update.payload,
                        callback: update.callback,

                        next: null,
                    };
                    newLastBaseUpdate = newLastBaseUpdate.next = clone;
                }
                markRenderEventTimeAndConfig(updateEventTime, update.suspenseConfig);

                // Process this update.
                newState = getStateFromUpdate(workInProgress, queue, update, newState, props, instance);
                const callback = update.callback;
                if (callback !== null) {
                    workInProgress.effectTag |= Callback;
                    const effects = queue.effects;
                    if (effects === null) {
                        queue.effects = [update];
                    } else {
                        effects.push(update);
                    }
                }
            }
            update = update.next;
            if (update === null) {
                pendingQueue = queue.shared.pending;
                if (pendingQueue === null) {
                    break;
                } else {
                    const lastPendingUpdate = pendingQueue;
                    const firstPendingUpdate = lastPendingUpdate.next;
                    lastPendingUpdate.next = null;
                    update = firstPendingUpdate;
                    queue.lastBaseUpdate = lastPendingUpdate;
                    queue.shared.pending = null;
                }
            }
        } while (true);
  
        if (newLastBaseUpdate === null) {
            newBaseState = newState;
        }
  
        queue.baseState = newBaseState;
        queue.firstBaseUpdate = newFirstBaseUpdate;
        queue.lastBaseUpdate = newLastBaseUpdate;

        markSkippedUpdateLanes(newLanes);
        workInProgress.lanes = newLanes;
        workInProgress.memoizedState = newState;
    }
}

function createFiberFromTypeAndProps(type, key, pendingProps, owner, mode, lanes) {
    let fiberTag = IndeterminateComponent; // 初始值，不确定组件，值为2
    // 根据类型来解析
    let resolvedType = type;
    if (typeof type === 'function') {
        if (shouldConstruct(type)) { // Component.prototype && Component.prototype.isReactComponent
            fiberTag = ClassComponent; // class组件
        } else {
            if (__DEV__) {
                resolvedType = resolveFunctionForHotReloading(resolvedType);
            }
        }
    } else if (typeof type === 'string') {
        fiberTag = HostComponent; // 原生DOM节点
    } else {
        getTag: switch (type) {
            case REACT_FRAGMENT_TYPE:
                return createFiberFromFragment(pendingProps.children, mode, lanes, key);
            case REACT_DEBUG_TRACING_MODE_TYPE:
                fiberTag = Mode;
                mode |= DebugTracingMode;
                break;
            case REACT_STRICT_MODE_TYPE:
                fiberTag = Mode;
                mode |= StrictMode;
                break;
            case REACT_PROFILER_TYPE:
                return createFiberFromProfiler(pendingProps, mode, lanes, key);
            case REACT_SUSPENSE_TYPE:
                return createFiberFromSuspense(pendingProps, mode, lanes, key);
            case REACT_SUSPENSE_LIST_TYPE:
                return createFiberFromSuspenseList(pendingProps, mode, lanes, key);
            case REACT_OFFSCREEN_TYPE:
                return createFiberFromOffscreen(pendingProps, mode, lanes, key);
            case REACT_LEGACY_HIDDEN_TYPE:
                return createFiberFromLegacyHidden(pendingProps, mode, lanes, key);
            case REACT_SCOPE_TYPE:
                if (enableScopeAPI) {
                    return createFiberFromScope(type, pendingProps, mode, lanes, key);
                }
            // eslint-disable-next-line no-fallthrough
            default: {
                if (typeof type === 'object' && type !== null) {
                    switch (type.$$typeof) {
                        case REACT_PROVIDER_TYPE:
                            fiberTag = ContextProvider;
                            break getTag;
                        case REACT_CONTEXT_TYPE:
                            // This is a consumer
                            fiberTag = ContextConsumer;
                            break getTag;
                        case REACT_FORWARD_REF_TYPE:
                            fiberTag = ForwardRef;
                            if (__DEV__) {
                                resolvedType = resolveForwardRefForHotReloading(resolvedType);
                            }
                            break getTag;
                        case REACT_MEMO_TYPE:
                            fiberTag = MemoComponent;
                            break getTag;
                        case REACT_LAZY_TYPE:
                            fiberTag = LazyComponent;
                            resolvedType = null;
                            break getTag;
                        case REACT_BLOCK_TYPE:
                            fiberTag = Block;
                            break getTag;
                        case REACT_FUNDAMENTAL_TYPE:
                            if (enableFundamentalAPI) {
                                return createFiberFromFundamental(
                                    type,
                                    pendingProps,
                                    mode,
                                    lanes,
                                    key,
                                );
                            }
                            break;
                    }
                }
                let info = '';
                if (__DEV__) {
                    if (
                        type === undefined ||
                        (typeof type === 'object' &&
                            type !== null &&
                            Object.keys(type).length === 0)
                    ) {
                        info +=
                            ' You likely forgot to export your component from the file ' +
                            "it's defined in, or you might have mixed up default and " +
                            'named imports.';
                    }
                    const ownerName = owner ? getComponentName(owner.type) : null;
                    if (ownerName) {
                        info += '\n\nCheck the render method of `' + ownerName + '`.';
                    }
                }
                invariant(
                    false,
                    'Element type is invalid: expected a string (for built-in ' +
                    'components) or a class/function (for composite components) ' +
                    'but got: %s.%s',
                    type == null ? type : typeof type,
                    info,
                );
            }
        }
    }
    const fiber = createFiber(fiberTag, pendingProps, key, mode);
    fiber.elementType = type;
    fiber.type = resolvedType;
    fiber.lanes = lanes;
    return fiber;
}

function createFiberFromElement(element, mode, lanes) {
    let owner = null;
    if (__DEV__) {
        owner = element._owner;
    }
    const type = element.type;
    const key = element.key;
    const pendingProps = element.props;
    const fiber = createFiberFromTypeAndProps(type, key, pendingProps, owner, mode, lanes);
    return fiber;
}

function coerceRef(returnFiber, current, element) {
    const mixedRef = element.ref;
    if (mixedRef !== null && typeof mixedRef !== 'function' && typeof mixedRef !== 'object') { // 可能是string ref，给予警告
        // ...省略string ref 警告处理代码。
    }
    return mixedRef;
}

function deleteChild(returnFiber, childToDelete) {
    const last = returnFiber.lastEffect;
    if (last !== null) {
        last.nextEffect = childToDelete;
        returnFiber.lastEffect = childToDelete;
    } else {
        returnFiber.firstEffect = returnFiber.lastEffect = childToDelete;
    }
    const deletions = returnFiber.deletions;
    if (deletions === null) {
        returnFiber.deletions = [childToDelete];
        // TODO (effects) Rename this to better reflect its new usage (e.g. ChildDeletions)
        returnFiber.effectTag |= Deletion;
    } else {
        deletions.push(childToDelete);
    }
    childToDelete.nextEffect = null;
}

// 根据sibling属性删除剩余子项
function deleteRemainingChildren(returnFiber, currentFirstChild) {
    let childToDelete = currentFirstChild;
    while (childToDelete !== null) {
        deleteChild(returnFiber, childToDelete);
        childToDelete = childToDelete.sibling;
    }
    return null;
}

// 创建fiber节点，将index和sibling恢复初始值
function useFiber(fiber, pendingProps) {
    const clone = createWorkInProgress(fiber, pendingProps);
    clone.index = 0;
    clone.sibling = null;
    return clone;
}

function createFiberFromText(content, mode, lanes) {
    const fiber = createFiber(HostText, content, null, mode);
    fiber.lanes = lanes;
    return fiber;
}

function createChild(returnFiber, returnFiber, lanes) {
    if (typeof newChild === 'string' || typeof newChild === 'number') {
        const created = createFiberFromText('' + newChild, returnFiber.mode, lanes);
        created.return = returnFiber;
        return created;
    }

    if (typeof newChild === 'object' && newChild !== null) {
        switch (newChild.$$typeof) {
            case REACT_ELEMENT_TYPE: {
                const created = createFiberFromElement(newChild, returnFiber.mode, lanes);
                created.ref = coerceRef(returnFiber, null, newChild);
                created.return = returnFiber;
                return created;
            }
            case REACT_PORTAL_TYPE: {
                const created = createFiberFromPortal(newChild, returnFiber.mode, lanes);
                created.return = returnFiber;
                return created;
            }
            case REACT_LAZY_TYPE: {
                if (enableLazyElements) {
                    const payload = newChild._payload;
                    const init = newChild._init;
                    return createChild(returnFiber, init(payload), lanes);
                }
            }
        }

        if (isArray(newChild) || getIteratorFn(newChild)) {
            const created = createFiberFromFragment(newChild, returnFiber.mode, lanes, null);
            created.return = returnFiber;
            return created;
        }
    }
    return null;
}

function placeChild(newFiber, lastPlacedIndex, newIndex) {
    newFiber.index = newIndex;
    const current = newFiber.alternate;
    if (current !== null) {
        const oldIndex = current.index;
        if (oldIndex < lastPlacedIndex) {
            // This is a move.
            newFiber.effectTag = Placement;
            return lastPlacedIndex;
        } else {
            // This item can stay in place.
            return oldIndex;
        }
    } else {
        // This is an insertion.
        newFiber.effectTag = Placement;
        return lastPlacedIndex;
    }
}

// 协调类型为数组的节点
function reconcileChildrenArray(returnFiber, currentFirstChild, newChildren, lanes) {
    let resultingFirstChild = null;
    let previousNewFiber = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber = null;
    for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
        if (oldFiber.index > newIdx) {
            nextOldFiber = oldFiber;
            oldFiber = null;
        } else {
            nextOldFiber = oldFiber.sibling;
        }
        const newFiber = updateSlot(
            returnFiber,
            oldFiber,
            newChildren[newIdx],
            lanes,
        );
        if (newFiber === null) {
            // TODO: This breaks on empty slots like null children. That's
            // unfortunate because it triggers the slow path all the time. We need
            // a better way to communicate whether this was a miss or null,
            // boolean, undefined, etc.
            if (oldFiber === null) {
                oldFiber = nextOldFiber;
            }
            break;
        }
        if (shouldTrackSideEffects) {
            if (oldFiber && newFiber.alternate === null) {
                // We matched the slot, but we didn't reuse the existing fiber, so we
                // need to delete the existing child.
                deleteChild(returnFiber, oldFiber);
            }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
            // TODO: Move out of the loop. This only happens for the first run.
            resultingFirstChild = newFiber;
        } else {
            // TODO: Defer siblings if we're not at the right index for this slot.
            // I.e. if we had null values before, then we want to defer this
            // for each null value. However, we also don't want to call updateSlot
            // with the previous one.
            previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
        oldFiber = nextOldFiber;
    }

    if (newIdx === newChildren.length) {
        // We've reached the end of the new children. We can delete the rest.
        deleteRemainingChildren(returnFiber, oldFiber);
        return resultingFirstChild;
    }

    if (oldFiber === null) { // 初始化渲染时
        for (; newIdx < newChildren.length; newIdx++) {
            const newFiber = createChild(returnFiber, newChildren[newIdx], lanes);
            if (newFiber === null) {
                continue;
            }
            lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
            if (previousNewFiber === null) {
                // TODO: Move out of the loop. This only happens for the first run.
                resultingFirstChild = newFiber;
            } else {
                previousNewFiber.sibling = newFiber;
            }
            previousNewFiber = newFiber;
        }
        return resultingFirstChild; // 返回数组中第一个child
    }

    // TODO...
    // Add all children to a key map for quick lookups.
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    for (; newIdx < newChildren.length; newIdx++) {
        const newFiber = updateFromMap(
            existingChildren,
            returnFiber,
            newIdx,
            newChildren[newIdx],
            lanes,
        );
        if (newFiber !== null) {
            if (shouldTrackSideEffects) {
                if (newFiber.alternate !== null) {
                    // The new fiber is a work in progress, but if there exists a
                    // current, that means that we reused the fiber. We need to delete
                    // it from the child list so that we don't add it to the deletion
                    // list.
                    existingChildren.delete(
                        newFiber.key === null ? newIdx : newFiber.key,
                    );
                }
            }
            lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
            if (previousNewFiber === null) {
                resultingFirstChild = newFiber;
            } else {
                previousNewFiber.sibling = newFiber;
            }
            previousNewFiber = newFiber;
        }
    }

    if (shouldTrackSideEffects) {
        // Any existing children that weren't consumed above were deleted. We need
        // to add them to the deletion list.
        existingChildren.forEach(child => deleteChild(returnFiber, child));
    }

    return resultingFirstChild;
}

// 协调单个元素节点
function reconcileSingleElement(returnFiber, currentFirstChild, element, lanes) {
    const key = element.key;
    let child = currentFirstChild;
    while (child !== null) { // 初次渲染时 current.child = null
        if (child.key === key) { // current.child.key和workInProgress.child.key一致
            switch (child.tag) {
                case Fragment: {
                    if (element.type === REACT_FRAGMENT_TYPE) {
                        deleteRemainingChildren(returnFiber, child.sibling);
                        const existing = useFiber(child, element.props.children);
                        existing.return = returnFiber;
                        return existing;
                    }
                    break;
                }
                case Block:
                    if (enableBlocksAPI) {
                        let type = element.type;
                        if (type.$$typeof === REACT_LAZY_TYPE) {
                            type = resolveLazyType(type);
                        }
                        if (type.$$typeof === REACT_BLOCK_TYPE) {
                            // The new Block might not be initialized yet. We need to initialize
                            // it in case initializing it turns out it would match.
                            if (type._render === child.type._render) {
                                deleteRemainingChildren(returnFiber, child.sibling);
                                const existing = useFiber(child, element.props);
                                existing.type = type;
                                existing.return = returnFiber;
                                if (__DEV__) {
                                    existing._debugSource = element._source;
                                    existing._debugOwner = element._owner;
                                }
                                return existing;
                            }
                        }
                    }
                // We intentionally fallthrough here if enableBlocksAPI is not on.
                // eslint-disable-next-lined no-fallthrough
                default: {
                    if (
                        child.elementType === element.type ||
                        // Keep this check inline so it only runs on the false path:
                        (__DEV__
                            ? isCompatibleFamilyForHotReloading(child, element)
                            : false)
                    ) {
                        deleteRemainingChildren(returnFiber, child.sibling);
                        const existing = useFiber(child, element.props);
                        existing.ref = coerceRef(returnFiber, child, element);
                        existing.return = returnFiber;
                        if (__DEV__) {
                            existing._debugSource = element._source;
                            existing._debugOwner = element._owner;
                        }
                        return existing;
                    }
                    break;
                }
            }
            // Didn't match.
            deleteRemainingChildren(returnFiber, child);
            break;
        } else {
            deleteChild(returnFiber, child);
        }
        child = child.sibling;
    }

    if (element.type === REACT_FRAGMENT_TYPE) {
        const created = createFiberFromFragment(element.props.children, returnFiber.mode, lanes, element.key);
        created.return = returnFiber;
        return created;
    } else {
        const created = createFiberFromElement(element, returnFiber.mode, lanes);
        created.ref = coerceRef(returnFiber, currentFirstChild, element);
        created.return = returnFiber;
        return created;
    }
}

// 协调单个文本节点
function reconcileSingleTextNode(returnFiber, currentFirstChild, textContent, lanes) {
    if (currentFirstChild !== null && currentFirstChild.tag === HostText) {
        deleteRemainingChildren(returnFiber, currentFirstChild.sibling);
        const existing = useFiber(currentFirstChild, textContent);
        existing.return = returnFiber;
        return existing;
    }
    // 否则现有的节点不是文本节点，因此我们需要创建一个并删除现有的。
    deleteRemainingChildren(returnFiber, currentFirstChild);
    const created = createFiberFromText(textContent, returnFiber.mode, lanes);
    created.return = returnFiber;
    return created;
}

function placeSingleChild(newFiber) {
    // 设置singleChild.effectTag 为 Placement tag
    if (shouldTrackSideEffects && newFiber.alternate === null) {
        newFiber.effectTag = Placement; // 2
    }
    return newFiber;
}

function reconcileChildFibers(returnFiber, currentFirstChild, newChild, lanes) {
    // 判断child是否是Fragment
    const isUnkeyedTopLevelFragment = typeof newChild === 'object' && newChild !== null && newChild.type === REACT_FRAGMENT_TYPE && newChild.key === null;
    if (isUnkeyedTopLevelFragment) {
        newChild = newChild.props.children; // Fragment不需要处理自身，拿到children即可
    }
    const isObject = typeof newChild === 'object' && newChild !== null;
    if (isObject) {
        switch (newChild.$$typeof) {
            case REACT_ELEMENT_TYPE: // element。 通常都会进入到这里
                return placeSingleChild(
                    reconcileSingleElement(returnFiber, currentFirstChild, newChild, lanes),
                );
            case REACT_PORTAL_TYPE: // protal
                return placeSingleChild(
                    reconcileSinglePortal(returnFiber, currentFirstChild, newChild, lanes),
                );
            case REACT_LAZY_TYPE: // lazy
                if (enableLazyElements) {
                    const payload = newChild._payload;
                    const init = newChild._init;
                    return reconcileChildFibers(returnFiber, currentFirstChild, init(payload), lanes);
                }
        }
    }

    if (typeof newChild === 'string' || typeof newChild === 'number') {
        return placeSingleChild(
            reconcileSingleTextNode(returnFiber, currentFirstChild, '' + newChild, lanes),
        );
    }

    if (isArray(newChild)) {
        return reconcileChildrenArray(returnFiber, currentFirstChild, newChild, lanes);
    }

    if (getIteratorFn(newChild)) {
        return reconcileChildrenIterator(returnFiber, currentFirstChild, newChild, lanes);
    }

    // Remaining cases are all treated as empty.
    return deleteRemainingChildren(returnFiber, currentFirstChild);
}

function reconcileChildren(current, workInProgress, nextChildren, renderLanes) {
    if (current === null) { // 这是尚未渲染的新组件
        workInProgress.child = mountChildFibers(workInProgress, null, nextChildren, renderLanes);
    } else { // 这是执行更新的组件
        workInProgress.child = reconcileChildFibers(workInProgress, current.child, nextChildren, renderLanes);
    }
}

// 根fiber HostRoot
function updateHostRoot(current, workInProgress, renderLanes) {
    pushHostRootContext(workInProgress);
    const updateQueue = workInProgress.updateQueue;
    const nextProps = workInProgress.pendingProps;
    const prevState = workInProgress.memoizedState;
    const prevChildren = prevState !== null ? prevState.element : null;
    cloneUpdateQueue(current, workInProgress);
    // 计算并得到workInProgress.memoizedState（update.payload）
    processUpdateQueue(workInProgress, nextProps, null, renderLanes);
    const nextState = workInProgress.memoizedState;
    const nextChildren = nextState.element;
    if (nextChildren === prevChildren) {
        resetHydrationState();
        // 跳过子节点的更新，执行后续操作
        return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
    }
    const root = workInProgress.stateNode;
    if (root.hydrate && enterHydrationState(workInProgress)) {
        // TODO... hydrate=true 会执行这里
    } else {
        reconcileChildren(current, workInProgress, nextChildren, renderLanes); // 核心
        resetHydrationState(); // 重置hydrate一些信息
    }
    return workInProgress.child;
}

function updateHostText(current, workInProgress) {
    if (current === null) {
        tryToClaimNextHydratableInstance(workInProgress);
    }
    return null;
}

function includesSomeLane(a, b) {
    return (a & b) !== NoLanes;
}

export function beginWork(current, workInProgress, renderLanes) {
    const updateLanes = workInProgress.lanes;

    if (current !== null) { // 初次渲染会进入到这里，current是否为null可以用来区分每个组件是mount还是update
        const oldProps = current.memoizedProps;
        const newProps = workInProgress.pendingProps;
        // 如果props或者环境(context)发生变化，标记fiber为已完成工作（didReceiveUpdate=true）
        if (oldProps !== newProps || hasLegacyContextChanged() || (__DEV__ ? workInProgress.type !== current.type : false)) {
            didReceiveUpdate = true;
        } else if (!includesSomeLane(renderLanes, updateLanes)) { // 表示当前fiber没有任何待处理工作
            didReceiveUpdate = false;
            switch (workInProgress.tag) {
                case HostRoot:
                    pushHostRootContext(workInProgress);
                    resetHydrationState();
                    break;
                case HostComponent:
                    pushHostContext(workInProgress);
                    break;
                case ClassComponent: {
                    const Component = workInProgress.type;
                    if (isLegacyContextProvider(Component)) {
                        pushLegacyContextProvider(workInProgress);
                    }
                    break;
                }
                case HostPortal:
                    pushHostContainer(
                        workInProgress,
                        workInProgress.stateNode.containerInfo,
                    );
                    break;
                case ContextProvider: {
                    const newValue = workInProgress.memoizedProps.value;
                    pushProvider(workInProgress, newValue);
                    break;
                }
                case Profiler:
                    if (enableProfilerTimer) {
                        // Profiler should only call onRender when one of its descendants actually rendered.
                        const hasChildWork = includesSomeLane(
                            renderLanes,
                            workInProgress.childLanes,
                        );
                        if (hasChildWork) {
                            workInProgress.effectTag |= Update;
                        }

                        // Reset effect durations for the next eventual effect phase.
                        // These are reset during render to allow the DevTools commit hook a chance to read them,
                        const stateNode = workInProgress.stateNode;
                        stateNode.effectDuration = 0;
                        stateNode.passiveEffectDuration = 0;
                    }
                    break;
                case SuspenseComponent: {
                    const state: SuspenseState | null = workInProgress.memoizedState;
                    if (state !== null) {
                        if (enableSuspenseServerRenderer) {
                            if (state.dehydrated !== null) {
                                pushSuspenseContext(
                                    workInProgress,
                                    setDefaultShallowSuspenseContext(suspenseStackCursor.current),
                                );
                                // We know that this component will suspend again because if it has
                                // been unsuspended it has committed as a resolved Suspense component.
                                // If it needs to be retried, it should have work scheduled on it.
                                workInProgress.effectTag |= DidCapture;
                                // We should never render the children of a dehydrated boundary until we
                                // upgrade it. We return null instead of bailoutOnAlreadyFinishedWork.
                                return null;
                            }
                        }

                        // If this boundary is currently timed out, we need to decide
                        // whether to retry the primary children, or to skip over it and
                        // go straight to the fallback. Check the priority of the primary
                        // child fragment.
                        const primaryChildFragment: Fiber = (workInProgress.child: any);
                        const primaryChildLanes = primaryChildFragment.childLanes;
                        if (includesSomeLane(renderLanes, primaryChildLanes)) {
                            // The primary children have pending work. Use the normal path
                            // to attempt to render the primary children again.
                            return updateSuspenseComponent(
                                current,
                                workInProgress,
                                renderLanes,
                            );
                        } else {
                            // The primary child fragment does not have pending work marked
                            // on it
                            pushSuspenseContext(
                                workInProgress,
                                setDefaultShallowSuspenseContext(suspenseStackCursor.current),
                            );
                            // The primary children do not have pending work with sufficient
                            // priority. Bailout.
                            const child = bailoutOnAlreadyFinishedWork(
                                current,
                                workInProgress,
                                renderLanes,
                            );
                            if (child !== null) {
                                // The fallback children have pending work. Skip over the
                                // primary children and work on the fallback.
                                return child.sibling;
                            } else {
                                return null;
                            }
                        }
                    } else {
                        pushSuspenseContext(
                            workInProgress,
                            setDefaultShallowSuspenseContext(suspenseStackCursor.current),
                        );
                    }
                    break;
                }
                case SuspenseListComponent: {
                    const didSuspendBefore =
                        (current.effectTag & DidCapture) !== NoEffect;

                    const hasChildWork = includesSomeLane(
                        renderLanes,
                        workInProgress.childLanes,
                    );

                    if (didSuspendBefore) {
                        if (hasChildWork) {
                            // If something was in fallback state last time, and we have all the
                            // same children then we're still in progressive loading state.
                            // Something might get unblocked by state updates or retries in the
                            // tree which will affect the tail. So we need to use the normal
                            // path to compute the correct tail.
                            return updateSuspenseListComponent(
                                current,
                                workInProgress,
                                renderLanes,
                            );
                        }
                        // If none of the children had any work, that means that none of
                        // them got retried so they'll still be blocked in the same way
                        // as before. We can fast bail out.
                        workInProgress.effectTag |= DidCapture;
                    }

                    // If nothing suspended before and we're rendering the same children,
                    // then the tail doesn't matter. Anything new that suspends will work
                    // in the "together" mode, so we can continue from the state we had.
                    const renderState = workInProgress.memoizedState;
                    if (renderState !== null) {
                        // Reset to the "together" mode in case we've started a different
                        // update in the past but didn't complete it.
                        renderState.rendering = null;
                        renderState.tail = null;
                        renderState.lastEffect = null;
                    }
                    pushSuspenseContext(workInProgress, suspenseStackCursor.current);

                    if (hasChildWork) {
                        break;
                    } else {
                        // If none of the children had any work, that means that none of
                        // them got retried so they'll still be blocked in the same way
                        // as before. We can fast bail out.
                        return null;
                    }
                }
                case OffscreenComponent:
                case LegacyHiddenComponent: {
                    // Need to check if the tree still needs to be deferred. This is
                    // almost identical to the logic used in the normal update path,
                    // so we'll just enter that. The only difference is we'll bail out
                    // at the next level instead of this one, because the child props
                    // have not changed. Which is fine.
                    // TODO: Probably should refactor `beginWork` to split the bailout
                    // path from the normal path. I'm tempted to do a labeled break here
                    // but I won't :)
                    workInProgress.lanes = NoLanes;
                    return updateOffscreenComponent(current, workInProgress, renderLanes);
                }
            }
            return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
        } else {
            if ((current.effectTag & ForceUpdateForLegacySuspense) !== NoEffect) {
                // 这是一个只存在于传统模式的特殊情况。
                didReceiveUpdate = true;
            } else {
                didReceiveUpdate = false;
            }
        }
    } else {
        didReceiveUpdate = false;
    }

    // 进入开始阶段之前，清除挂起的更新优先级
    workInProgress.lanes = NoLanes;
    switch (workInProgress.tag) {
        case IndeterminateComponent: {
            return mountIndeterminateComponent(
                current,
                workInProgress,
                workInProgress.type,
                renderLanes,
            );
        }
        case LazyComponent: {
            const elementType = workInProgress.elementType;
            return mountLazyComponent(
                current,
                workInProgress,
                elementType,
                updateLanes,
                renderLanes,
            );
        }
        case FunctionComponent: {
            const Component = workInProgress.type;
            const unresolvedProps = workInProgress.pendingProps;
            const resolvedProps =
                workInProgress.elementType === Component
                    ? unresolvedProps
                    : resolveDefaultProps(Component, unresolvedProps);
            return updateFunctionComponent(
                current,
                workInProgress,
                Component,
                resolvedProps,
                renderLanes,
            );
        }
        case ClassComponent: {
            const Component = workInProgress.type;
            const unresolvedProps = workInProgress.pendingProps;
            const resolvedProps =
                workInProgress.elementType === Component
                    ? unresolvedProps
                    : resolveDefaultProps(Component, unresolvedProps);
            return updateClassComponent(
                current,
                workInProgress,
                Component,
                resolvedProps,
                renderLanes,
            );
        }
        case HostRoot: // 初次渲染进入到这里
            return updateHostRoot(current, workInProgress, renderLanes);
        case HostComponent:
            return updateHostComponent(current, workInProgress, renderLanes);
        case HostText:
            return updateHostText(current, workInProgress);
        case SuspenseComponent:
            return updateSuspenseComponent(current, workInProgress, renderLanes);
        case HostPortal:
            return updatePortalComponent(current, workInProgress, renderLanes);
        case ForwardRef: {
            const type = workInProgress.type;
            const unresolvedProps = workInProgress.pendingProps;
            const resolvedProps =
                workInProgress.elementType === type
                    ? unresolvedProps
                    : resolveDefaultProps(type, unresolvedProps);
            return updateForwardRef(
                current,
                workInProgress,
                type,
                resolvedProps,
                renderLanes,
            );
        }
        case Fragment:
            return updateFragment(current, workInProgress, renderLanes);
        case Mode:
            return updateMode(current, workInProgress, renderLanes);
        case Profiler:
            return updateProfiler(current, workInProgress, renderLanes);
        case ContextProvider:
            return updateContextProvider(current, workInProgress, renderLanes);
        case ContextConsumer:
            return updateContextConsumer(current, workInProgress, renderLanes);
        case MemoComponent: {
            const type = workInProgress.type;
            const unresolvedProps = workInProgress.pendingProps;
            // Resolve outer props first, then resolve inner props.
            let resolvedProps = resolveDefaultProps(type, unresolvedProps);
            if (__DEV__) {
                if (workInProgress.type !== workInProgress.elementType) {
                    const outerPropTypes = type.propTypes;
                    if (outerPropTypes) {
                        checkPropTypes(
                            outerPropTypes,
                            resolvedProps, // Resolved for outer only
                            'prop',
                            getComponentName(type),
                        );
                    }
                }
            }
            resolvedProps = resolveDefaultProps(type.type, resolvedProps);
            return updateMemoComponent(
                current,
                workInProgress,
                type,
                resolvedProps,
                updateLanes,
                renderLanes,
            );
        }
        case SimpleMemoComponent: {
            return updateSimpleMemoComponent(
                current,
                workInProgress,
                workInProgress.type,
                workInProgress.pendingProps,
                updateLanes,
                renderLanes,
            );
        }
        case IncompleteClassComponent: {
            const Component = workInProgress.type;
            const unresolvedProps = workInProgress.pendingProps;
            const resolvedProps =
                workInProgress.elementType === Component
                    ? unresolvedProps
                    : resolveDefaultProps(Component, unresolvedProps);
            return mountIncompleteClassComponent(
                current,
                workInProgress,
                Component,
                resolvedProps,
                renderLanes,
            );
        }
        case SuspenseListComponent: {
            return updateSuspenseListComponent(current, workInProgress, renderLanes);
        }
        case FundamentalComponent: {
            if (enableFundamentalAPI) {
                return updateFundamentalComponent(current, workInProgress, renderLanes);
            }
            break;
        }
        case ScopeComponent: {
            if (enableScopeAPI) {
                return updateScopeComponent(current, workInProgress, renderLanes);
            }
            break;
        }
        case Block: {
            if (enableBlocksAPI) {
                const block = workInProgress.type;
                const props = workInProgress.pendingProps;
                return updateBlock(current, workInProgress, block, props, renderLanes);
            }
            break;
        }
        case OffscreenComponent: {
            return updateOffscreenComponent(current, workInProgress, renderLanes);
        }
        case LegacyHiddenComponent: {
            return updateLegacyHiddenComponent(current, workInProgress, renderLanes);
        }
    }
}