const Incomplete = /*                   */ 0b0000100000000000; // 2048
const internalInstanceKey = '__reactFiber$' + randomKey;

function precacheFiberNode(hostInst, node) {
    node[internalInstanceKey] = hostInst;
}

function getOwnerDocumentFromRootContainer(rootContainerElement) {
    return rootContainerElement.nodeType === DOCUMENT_NODE ? rootContainerElement : rootContainerElement.ownerDocument;
}

function createTextNode(text, rootContainerElement) {
    return getOwnerDocumentFromRootContainer(rootContainerElement).createTextNode(text);
}

// 创建文本实例
function createTextInstance(text, rootContainerInstance, hostContext, internalInstanceHandle) {
    const textNode = createTextNode(text, rootContainerInstance);
    precacheFiberNode(internalInstanceHandle, textNode);
    return textNode;
}

function popHostContainer(fiber) {
    pop(contextStackCursor, fiber);
    pop(contextFiberStackCursor, fiber);
    pop(rootInstanceStackCursor, fiber);
}
function popTopLevelLegacyContextObject(fiber) {
    pop(didPerformWorkStackCursor, fiber);
    pop(contextStackCursor, fiber);
}

function completeWork(current, workInProgress, renderLanes) {
    const newProps = workInProgress.pendingProps;
    switch (workInProgress.tag) {
        case IndeterminateComponent:
        case LazyComponent:
        case SimpleMemoComponent:
        case FunctionComponent:
        case ForwardRef:
        case Fragment:
        case Mode:
        case Profiler:
        case ContextConsumer:
        case MemoComponent:
            return null;
        case ClassComponent: {
            const Component = workInProgress.type;
            if (isLegacyContextProvider(Component)) {
                popLegacyContext(workInProgress);
            }
            return null;
        }
        case HostRoot: {
            popHostContainer(workInProgress);
            popTopLevelLegacyContextObject(workInProgress);
            resetMutableSourceWorkInProgressVersions(); // 将workInProgressSources置为空数组
            const fiberRoot = workInProgress.stateNode; // HostRoot初始化就存在，也就是FiberRootNode
            if (fiberRoot.pendingContext) {
                fiberRoot.context = fiberRoot.pendingContext;
                fiberRoot.pendingContext = null;
            }
            if (current === null || current.child === null) { // 初次渲染时current.child = null
                const wasHydrated = popHydrationState(workInProgress);
                if (wasHydrated) {
                    markUpdate(workInProgress);
                } else if (!fiberRoot.hydrate) { // React.render 进入这里
                    workInProgress.effectTag |= Snapshot; // Snapshot = 256
                }
            }
            updateHostContainer(current, workInProgress); // 初次渲染时这是一个空函数
            return null;
        }
        case HostComponent: {
            popHostContext(workInProgress);
            const rootContainerInstance = getRootHostContainer();
            const type = workInProgress.type;
            if (current !== null && workInProgress.stateNode != null) {
                updateHostComponent(
                    current,
                    workInProgress,
                    type,
                    newProps,
                    rootContainerInstance,
                );

                if (current.ref !== workInProgress.ref) {
                    markRef(workInProgress);
                }
            } else {
                if (!newProps) {
                    invariant(
                        workInProgress.stateNode !== null,
                        'We must have new props for new mounts. This error is likely ' +
                        'caused by a bug in React. Please file an issue.',
                    );
                    // This can happen when we abort work.
                    return null;
                }

                const currentHostContext = getHostContext();
                // TODO: Move createInstance to beginWork and keep it on a context
                // "stack" as the parent. Then append children as we go in beginWork
                // or completeWork depending on whether we want to add them top->down or
                // bottom->up. Top->down is faster in IE11.
                const wasHydrated = popHydrationState(workInProgress);
                if (wasHydrated) {
                    // TODO: Move this and createInstance step into the beginPhase
                    // to consolidate.
                    if (
                        prepareToHydrateHostInstance(
                            workInProgress,
                            rootContainerInstance,
                            currentHostContext,
                        )
                    ) {
                        // If changes to the hydrated node need to be applied at the
                        // commit-phase we mark this as such.
                        markUpdate(workInProgress);
                    }
                } else {
                    const instance = createInstance(
                        type,
                        newProps,
                        rootContainerInstance,
                        currentHostContext,
                        workInProgress,
                    );

                    appendAllChildren(instance, workInProgress, false, false);

                    workInProgress.stateNode = instance;

                    // Certain renderers require commit-time effects for initial mount.
                    // (eg DOM renderer supports auto-focus for certain elements).
                    // Make sure such renderers get scheduled for later work.
                    if (
                        finalizeInitialChildren(
                            instance,
                            type,
                            newProps,
                            rootContainerInstance,
                            currentHostContext,
                        )
                    ) {
                        markUpdate(workInProgress);
                    }
                }

                if (workInProgress.ref !== null) {
                    // If there is a ref on a host node we need to schedule a callback
                    markRef(workInProgress);
                }
            }
            return null;
        }
        case HostText: {
            const newText = newProps;
            if (current && workInProgress.stateNode != null) { // update
                const oldText = current.memoizedProps;
                updateHostText(current, workInProgress, oldText, newText);
            } else { // mount
                const rootContainerInstance = getRootHostContainer(); // id=root
                const currentHostContext = getHostContext();
                const wasHydrated = popHydrationState(workInProgress); // false
                if (wasHydrated) {
                    if (prepareToHydrateHostTextInstance(workInProgress)) {
                        markUpdate(workInProgress);
                    }
                } else {
                    // 创建fiber对应的DOM节点(stateNode)
                    workInProgress.stateNode = createTextInstance(
                        newText,
                        rootContainerInstance,
                        currentHostContext,
                        workInProgress,
                    );
                }
            }
            return null;
        }
        case SuspenseComponent: {
            popSuspenseContext(workInProgress);
            const nextState: null | SuspenseState = workInProgress.memoizedState;

            if (enableSuspenseServerRenderer) {
                if (nextState !== null && nextState.dehydrated !== null) {
                    if (current === null) {
                        const wasHydrated = popHydrationState(workInProgress);
                        invariant(
                            wasHydrated,
                            'A dehydrated suspense component was completed without a hydrated node. ' +
                            'This is probably a bug in React.',
                        );
                        prepareToHydrateHostSuspenseInstance(workInProgress);
                        if (enableSchedulerTracing) {
                            markSpawnedWork(OffscreenLane);
                        }
                        return null;
                    } else {
                        // We should never have been in a hydration state if we didn't have a current.
                        // However, in some of those paths, we might have reentered a hydration state
                        // and then we might be inside a hydration state. In that case, we'll need to exit out of it.
                        resetHydrationState();
                        if ((workInProgress.effectTag & DidCapture) === NoEffect) {
                            // This boundary did not suspend so it's now hydrated and unsuspended.
                            workInProgress.memoizedState = null;
                        }
                        // If nothing suspended, we need to schedule an effect to mark this boundary
                        // as having hydrated so events know that they're free to be invoked.
                        // It's also a signal to replay events and the suspense callback.
                        // If something suspended, schedule an effect to attach retry listeners.
                        // So we might as well always mark this.
                        workInProgress.effectTag |= Update;
                        return null;
                    }
                }
            }

            if ((workInProgress.effectTag & DidCapture) !== NoEffect) {
                // Something suspended. Re-render with the fallback children.
                workInProgress.lanes = renderLanes;
                // Do not reset the effect list.
                if (
                    enableProfilerTimer &&
                    (workInProgress.mode & ProfileMode) !== NoMode
                ) {
                    transferActualDuration(workInProgress);
                }
                return workInProgress;
            }

            const nextDidTimeout = nextState !== null;
            let prevDidTimeout = false;
            if (current === null) {
                if (workInProgress.memoizedProps.fallback !== undefined) {
                    popHydrationState(workInProgress);
                }
            } else {
                const prevState: null | SuspenseState = current.memoizedState;
                prevDidTimeout = prevState !== null;
            }

            if (nextDidTimeout && !prevDidTimeout) {
                // If this subtreee is running in blocking mode we can suspend,
                // otherwise we won't suspend.
                // TODO: This will still suspend a synchronous tree if anything
                // in the concurrent tree already suspended during this render.
                // This is a known bug.
                if ((workInProgress.mode & BlockingMode) !== NoMode) {
                    // TODO: Move this back to throwException because this is too late
                    // if this is a large tree which is common for initial loads. We
                    // don't know if we should restart a render or not until we get
                    // this marker, and this is too late.
                    // If this render already had a ping or lower pri updates,
                    // and this is the first time we know we're going to suspend we
                    // should be able to immediately restart from within throwException.
                    const hasInvisibleChildContext =
                        current === null &&
                        workInProgress.memoizedProps.unstable_avoidThisFallback !== true;
                    if (
                        hasInvisibleChildContext ||
                        hasSuspenseContext(
                            suspenseStackCursor.current,
                            (InvisibleParentSuspenseContext: SuspenseContext),
                        )
                    ) {
                        // If this was in an invisible tree or a new render, then showing
                        // this boundary is ok.
                        renderDidSuspend();
                    } else {
                        // Otherwise, we're going to have to hide content so we should
                        // suspend for longer if possible.
                        renderDidSuspendDelayIfPossible();
                    }
                }
            }

            if (supportsPersistence) {
                // TODO: Only schedule updates if not prevDidTimeout.
                if (nextDidTimeout) {
                    // If this boundary just timed out, schedule an effect to attach a
                    // retry listener to the promise. This flag is also used to hide the
                    // primary children.
                    workInProgress.effectTag |= Update;
                }
            }
            if (supportsMutation) {
                // TODO: Only schedule updates if these values are non equal, i.e. it changed.
                if (nextDidTimeout || prevDidTimeout) {
                    // If this boundary just timed out, schedule an effect to attach a
                    // retry listener to the promise. This flag is also used to hide the
                    // primary children. In mutation mode, we also need the flag to
                    // *unhide* children that were previously hidden, so check if this
                    // is currently timed out, too.
                    workInProgress.effectTag |= Update;
                }
            }
            if (
                enableSuspenseCallback &&
                workInProgress.updateQueue !== null &&
                workInProgress.memoizedProps.suspenseCallback != null
            ) {
                // Always notify the callback
                workInProgress.effectTag |= Update;
            }
            return null;
        }
        case HostPortal:
            popHostContainer(workInProgress);
            updateHostContainer(current, workInProgress);
            if (current === null) {
                preparePortalMount(workInProgress.stateNode.containerInfo);
            }
            return null;
        case ContextProvider:
            // Pop provider fiber
            popProvider(workInProgress);
            return null;
        case IncompleteClassComponent: {
            // Same as class component case. I put it down here so that the tags are
            // sequential to ensure this switch is compiled to a jump table.
            const Component = workInProgress.type;
            if (isLegacyContextProvider(Component)) {
                popLegacyContext(workInProgress);
            }
            return null;
        }
        case SuspenseListComponent: {
            popSuspenseContext(workInProgress);

            const renderState: null | SuspenseListRenderState =
                workInProgress.memoizedState;

            if (renderState === null) {
                // We're running in the default, "independent" mode.
                // We don't do anything in this mode.
                return null;
            }

            let didSuspendAlready =
                (workInProgress.effectTag & DidCapture) !== NoEffect;

            const renderedTail = renderState.rendering;
            if (renderedTail === null) {
                // We just rendered the head.
                if (!didSuspendAlready) {
                    // This is the first pass. We need to figure out if anything is still
                    // suspended in the rendered set.

                    // If new content unsuspended, but there's still some content that
                    // didn't. Then we need to do a second pass that forces everything
                    // to keep showing their fallbacks.

                    // We might be suspended if something in this render pass suspended, or
                    // something in the previous committed pass suspended. Otherwise,
                    // there's no chance so we can skip the expensive call to
                    // findFirstSuspended.
                    const cannotBeSuspended =
                        renderHasNotSuspendedYet() &&
                        (current === null || (current.effectTag & DidCapture) === NoEffect);
                    if (!cannotBeSuspended) {
                        let row = workInProgress.child;
                        while (row !== null) {
                            const suspended = findFirstSuspended(row);
                            if (suspended !== null) {
                                didSuspendAlready = true;
                                workInProgress.effectTag |= DidCapture;
                                cutOffTailIfNeeded(renderState, false);

                                // If this is a newly suspended tree, it might not get committed as
                                // part of the second pass. In that case nothing will subscribe to
                                // its thennables. Instead, we'll transfer its thennables to the
                                // SuspenseList so that it can retry if they resolve.
                                // There might be multiple of these in the list but since we're
                                // going to wait for all of them anyway, it doesn't really matter
                                // which ones gets to ping. In theory we could get clever and keep
                                // track of how many dependencies remain but it gets tricky because
                                // in the meantime, we can add/remove/change items and dependencies.
                                // We might bail out of the loop before finding any but that
                                // doesn't matter since that means that the other boundaries that
                                // we did find already has their listeners attached.
                                const newThennables = suspended.updateQueue;
                                if (newThennables !== null) {
                                    workInProgress.updateQueue = newThennables;
                                    workInProgress.effectTag |= Update;
                                }

                                // Rerender the whole list, but this time, we'll force fallbacks
                                // to stay in place.
                                // Reset the effect list before doing the second pass since that's now invalid.
                                if (renderState.lastEffect === null) {
                                    workInProgress.firstEffect = null;
                                    workInProgress.subtreeTag = NoEffect;
                                    let child = workInProgress.child;
                                    while (child !== null) {
                                        child.deletions = null;
                                        child = child.sibling;
                                    }
                                }
                                workInProgress.lastEffect = renderState.lastEffect;
                                // Reset the child fibers to their original state.
                                resetChildFibers(workInProgress, renderLanes);

                                // Set up the Suspense Context to force suspense and immediately
                                // rerender the children.
                                pushSuspenseContext(
                                    workInProgress,
                                    setShallowSuspenseContext(
                                        suspenseStackCursor.current,
                                        ForceSuspenseFallback,
                                    ),
                                );
                                return workInProgress.child;
                            }
                            row = row.sibling;
                        }
                    }
                } else {
                    cutOffTailIfNeeded(renderState, false);
                }
                // Next we're going to render the tail.
            } else {
                // Append the rendered row to the child list.
                if (!didSuspendAlready) {
                    const suspended = findFirstSuspended(renderedTail);
                    if (suspended !== null) {
                        workInProgress.effectTag |= DidCapture;
                        didSuspendAlready = true;

                        // Ensure we transfer the update queue to the parent so that it doesn't
                        // get lost if this row ends up dropped during a second pass.
                        const newThennables = suspended.updateQueue;
                        if (newThennables !== null) {
                            workInProgress.updateQueue = newThennables;
                            workInProgress.effectTag |= Update;
                        }

                        cutOffTailIfNeeded(renderState, true);
                        // This might have been modified.
                        if (
                            renderState.tail === null &&
                            renderState.tailMode === 'hidden' &&
                            !renderedTail.alternate &&
                            !getIsHydrating() // We don't cut it if we're hydrating.
                        ) {
                            // We need to delete the row we just rendered.
                            // Reset the effect list to what it was before we rendered this
                            // child. The nested children have already appended themselves.
                            const lastEffect = (workInProgress.lastEffect =
                                renderState.lastEffect);
                            // Remove any effects that were appended after this point.
                            if (lastEffect !== null) {
                                lastEffect.nextEffect = null;
                            }
                            // We're done.
                            return null;
                        }
                    } else if (
                        // The time it took to render last row is greater than time until
                        // the expiration.
                        now() * 2 - renderState.renderingStartTime >
                        renderState.tailExpiration &&
                        renderLanes !== OffscreenLane
                    ) {
                        // We have now passed our CPU deadline and we'll just give up further
                        // attempts to render the main content and only render fallbacks.
                        // The assumption is that this is usually faster.
                        workInProgress.effectTag |= DidCapture;
                        didSuspendAlready = true;

                        cutOffTailIfNeeded(renderState, false);

                        // Since nothing actually suspended, there will nothing to ping this
                        // to get it started back up to attempt the next item. If we can show
                        // them, then they really have the same priority as this render.
                        // So we'll pick it back up the very next render pass once we've had
                        // an opportunity to yield for paint.
                        workInProgress.lanes = renderLanes;
                        if (enableSchedulerTracing) {
                            markSpawnedWork(renderLanes);
                        }
                    }
                }
                if (renderState.isBackwards) {
                    // The effect list of the backwards tail will have been added
                    // to the end. This breaks the guarantee that life-cycles fire in
                    // sibling order but that isn't a strong guarantee promised by React.
                    // Especially since these might also just pop in during future commits.
                    // Append to the beginning of the list.
                    renderedTail.sibling = workInProgress.child;
                    workInProgress.child = renderedTail;
                } else {
                    const previousSibling = renderState.last;
                    if (previousSibling !== null) {
                        previousSibling.sibling = renderedTail;
                    } else {
                        workInProgress.child = renderedTail;
                    }
                    renderState.last = renderedTail;
                }
            }

            if (renderState.tail !== null) {
                // We still have tail rows to render.
                if (renderState.tailExpiration === 0) {
                    // Heuristic for how long we're willing to spend rendering rows
                    // until we just give up and show what we have so far.
                    const TAIL_EXPIRATION_TIMEOUT_MS = 500;
                    renderState.tailExpiration = now() + TAIL_EXPIRATION_TIMEOUT_MS;
                    // TODO: This is meant to mimic the train model or JND but this
                    // is a per component value. It should really be since the start
                    // of the total render or last commit. Consider using something like
                    // globalMostRecentFallbackTime. That doesn't account for being
                    // suspended for part of the time or when it's a new render.
                    // It should probably use a global start time value instead.
                }
                // Pop a row.
                const next = renderState.tail;
                renderState.rendering = next;
                renderState.tail = next.sibling;
                renderState.lastEffect = workInProgress.lastEffect;
                renderState.renderingStartTime = now();
                next.sibling = null;

                // Restore the context.
                // TODO: We can probably just avoid popping it instead and only
                // setting it the first time we go from not suspended to suspended.
                let suspenseContext = suspenseStackCursor.current;
                if (didSuspendAlready) {
                    suspenseContext = setShallowSuspenseContext(
                        suspenseContext,
                        ForceSuspenseFallback,
                    );
                } else {
                    suspenseContext = setDefaultShallowSuspenseContext(suspenseContext);
                }
                pushSuspenseContext(workInProgress, suspenseContext);
                // Do a pass over the next row.
                return next;
            }
            return null;
        }
        case FundamentalComponent: {
            if (enableFundamentalAPI) {
                const fundamentalImpl = workInProgress.type.impl;
                let fundamentalInstance: ReactFundamentalComponentInstance<
                    any,
                    any,
                    > | null = workInProgress.stateNode;

                if (fundamentalInstance === null) {
                    const getInitialState = fundamentalImpl.getInitialState;
                    let fundamentalState;
                    if (getInitialState !== undefined) {
                        fundamentalState = getInitialState(newProps);
                    }
                    fundamentalInstance = workInProgress.stateNode = createFundamentalStateInstance(
                        workInProgress,
                        newProps,
                        fundamentalImpl,
                        fundamentalState || {},
                    );
                    const instance = ((getFundamentalComponentInstance(
                        fundamentalInstance,
                    ): any): Instance);
                    fundamentalInstance.instance = instance;
                    if (fundamentalImpl.reconcileChildren === false) {
                        return null;
                    }
                    appendAllChildren(instance, workInProgress, false, false);
                    mountFundamentalComponent(fundamentalInstance);
                } else {
                    // We fire update in commit phase
                    const prevProps = fundamentalInstance.props;
                    fundamentalInstance.prevProps = prevProps;
                    fundamentalInstance.props = newProps;
                    fundamentalInstance.currentFiber = workInProgress;
                    if (supportsPersistence) {
                        const instance = cloneFundamentalInstance(fundamentalInstance);
                        fundamentalInstance.instance = instance;
                        appendAllChildren(instance, workInProgress, false, false);
                    }
                    const shouldUpdate = shouldUpdateFundamentalComponent(
                        fundamentalInstance,
                    );
                    if (shouldUpdate) {
                        markUpdate(workInProgress);
                    }
                }
                return null;
            }
            break;
        }
        case ScopeComponent: {
            if (enableScopeAPI) {
                if (current === null) {
                    const scopeInstance: ReactScopeInstance = createScopeInstance();
                    workInProgress.stateNode = scopeInstance;
                    prepareScopeUpdate(scopeInstance, workInProgress);
                    if (workInProgress.ref !== null) {
                        markRef(workInProgress);
                        markUpdate(workInProgress);
                    }
                } else {
                    if (workInProgress.ref !== null) {
                        markUpdate(workInProgress);
                    }
                    if (current.ref !== workInProgress.ref) {
                        markRef(workInProgress);
                    }
                }
                return null;
            }
            break;
        }
        case Block:
            if (enableBlocksAPI) {
                return null;
            }
            break;
        case OffscreenComponent:
        case LegacyHiddenComponent: {
            popRenderLanes(workInProgress);
            if (current !== null) {
                const nextState: OffscreenState | null = workInProgress.memoizedState;
                const prevState: OffscreenState | null = current.memoizedState;

                const prevIsHidden = prevState !== null;
                const nextIsHidden = nextState !== null;
                if (
                    prevIsHidden !== nextIsHidden &&
                    newProps.mode !== 'unstable-defer-without-hiding'
                ) {
                    workInProgress.effectTag |= Update;
                }
            }
            return null;
        }
    }
}

function resetChildLanes(completedWork) {
    let newChildLanes = NoLanes;
    // TODO... 省略
    completedWork.childLanes = newChildLanes;
}

export function completeUnitOfWork(unitOfWork) {
    // 完成当前工作单元，并转到下一个单元（sibling），如果没有则返回父级fiber（return）
    let completedWork = unitOfWork;
    do {
        const current = completedWork.alternate; // 获取当前任务单元fiber对应页面上的fiber
        const returnFiber = completedWork.return; // 获取父fiber节点

        // Check if the work completed or if something threw.
        if ((completedWork.effectTag & Incomplete) === NoEffect) {
            let next;
            if (!enableProfilerTimer || (completedWork.mode & ProfileMode) === NoMode) {
                next = completeWork(current, completedWork, subtreeRenderLanes); // 初次渲染进入到这里
            } else {
                startProfilerTimer(completedWork);
                next = completeWork(current, completedWork, subtreeRenderLanes);
                // Update render duration assuming we didn't error.
                stopProfilerTimerIfRunningAndRecordDelta(completedWork, false);
            }

            if (next !== null) {
                workInProgress = next; // 完成当前fiber时产生了新工作，先处理新工作，之后再回来进行complete
                return;
            }
            resetChildLanes(completedWork); // 重置当前fiber的ChildLanes属性
            if (returnFiber !== null && (returnFiber.effectTag & Incomplete) === NoEffect) {
                // 实现EffectList
                if (returnFiber.firstEffect === null) {
                    returnFiber.firstEffect = completedWork.firstEffect;
                }
                if (completedWork.lastEffect !== null) {
                    if (returnFiber.lastEffect !== null) {
                        returnFiber.lastEffect.nextEffect = completedWork.firstEffect;
                    }
                    returnFiber.lastEffect = completedWork.lastEffect;
                }

                const effectTag = completedWork.effectTag;
                if (effectTag > PerformedWork) { // PerformedWork = 1
                    if (returnFiber.lastEffect !== null) {
                        returnFiber.lastEffect.nextEffect = completedWork;
                    } else {
                        returnFiber.firstEffect = completedWork;
                    }
                    returnFiber.lastEffect = completedWork;
                }
            }
        } else {
            // 当前fiber还没有完成
            const next = unwindWork(completedWork, subtreeRenderLanes);
            if (next !== null) {
                next.effectTag &= HostEffectMask;
                workInProgress = next;
                return;
            }
            if (enableProfilerTimer && (completedWork.mode & ProfileMode) !== NoMode) {
                // Record the render duration for the fiber that errored.
                stopProfilerTimerIfRunningAndRecordDelta(completedWork, false);

                // Include the time spent working on failed children before continuing.
                let actualDuration = completedWork.actualDuration;
                let child = completedWork.child;
                while (child !== null) {
                    actualDuration += child.actualDuration;
                    child = child.sibling;
                }
                completedWork.actualDuration = actualDuration;
            }

            if (returnFiber !== null) {
                // Mark the parent fiber as incomplete and clear its effect list.
                returnFiber.firstEffect = returnFiber.lastEffect = null;
                returnFiber.effectTag |= Incomplete;
                returnFiber.subtreeTag = NoSubtreeTag;
                returnFiber.deletions = null;
            }
        }

        const siblingFiber = completedWork.sibling;
        if (siblingFiber !== null) { // 当前fiber节点complete完成后，进入下一个sibling节点的beginWork阶段
            workInProgress = siblingFiber;
            return;
        }
        // Otherwise, return to the parent  否则，返回父级
        completedWork = returnFiber; // 父节点不需要再进行beginWork，通过while循环进入complete阶段
        workInProgress = completedWork; // 最终循环处理到rootFiber，此时returnFiber为null，completedWork、workInProgress也更新为null，退出循环
    } while (completedWork !== null);

    // 最终我们会到达根节点
    if (workInProgressRootExitStatus === RootIncomplete) { // RootIncomplete = 0
        workInProgressRootExitStatus = RootCompleted; // RootCompleted = 5
    }
}