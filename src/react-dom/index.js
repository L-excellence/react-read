import { legacyCreateRootFromDOMContainer } from './createFiberRoot'; // 初次挂载时创建FiberRootNode
import { unbatchedUpdates, updateContainer } from './updateContainer';

function getPublicRootInstance(container) { // container ---> FiberRootNode
    const containerFiber = container.current; // rootFiber
    if (!containerFiber.child) {
        return null;
    }
    switch (containerFiber.child.tag) {
        case HostComponent: // fiber.tag === 5 原生DOM节点会进入到这里
            return getPublicInstance(containerFiber.child.stateNode); // getPublicInstance = node => node;
        default: // 函数组件、class组件会进入到这里，一般返回null，它们的stateNode=null
            return containerFiber.child.stateNode;
    }
}

function legacyRenderSubtreeIntoContainer(parentComponent, children, container, forceHydrate, callback) {
    let root = container._reactRootContainer;
    let fiberRoot;
    if (!root) {
        // Initial mount 根据container创建FiberRootNode
        root = container._reactRootContainer = legacyCreateRootFromDOMContainer(
            container,
            forceHydrate,
        );
        fiberRoot = root._internalRoot;
        // 一般场景中render不会传第三参数callback，可以不看，这里对callback的this指向进行处理
        if (typeof callback === 'function') {
            const originalCallback = callback;
            callback = function() {
                const instance = getPublicRootInstance(fiberRoot);
                originalCallback.call(instance);
            }
        }
        // 拿到FiberRootNode后开始更新DOM节点到页面中
        unbatchedUpdates(() => {
            updateContainer(children, fiberRoot, parentComponent, callback);
        });
    } else {
        // TODO... 暂时不考虑更新操作。更新根节点
    }
    return getPublicRootInstance(fiberRoot); // 返回ReactDOM.render第一参数(虚拟DOM)对应的真实DOM节点
}

function render(element, container, callback) {
    return legacyRenderSubtreeIntoContainer(null, element, container, false, callback);
}

export default {
    render
}