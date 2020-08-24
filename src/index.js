import React from 'react';
import ReactDOM from 'react-dom';

function App() {
    return <h1>hello react!</h1>;
}

class ClassComponent {
    render() {
        return <div>class 组件</div>
    }
}
// const child = ReactDOM.render(
//     <h1>hello react!</h1>,
//     document.getElementById('root')
// );
// console.log(child);
// console.log(React);


ReactDOM.render('hello react!', document.getElementById('root'));


// ReactDOM.render(['cyl', ' --- ', 'cegz'], document.getElementById('root'));

// ReactDOM.render(<h1>hello react!</h1>, document.getElementById('root'));

// ReactDOM.render(<App />, document.getElementById('root'));

// ReactDOM.render(<ClassComponent />, document.getElementById('root'));