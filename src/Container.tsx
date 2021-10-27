import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Node } from './Node';
import classNames from 'classnames';
import { ResizableProps } from 're-resizable';
import 'document.contains';
import './styles.less';
import { calcLineValues, calcPosValues, checkDragOut, getGuideLines, noop } from './utils';

/**
 * 表示组件支持通过 className 和 style 进行样式定制
 */
export interface StyledProps {
  /**
   * 组件自定义类名
   */
  className?: string;

  /**
   * 组件自定义样式
   */
  style?: React.CSSProperties;
}

export interface INode {
  id: string;
  position: NodePosition;
  render: (props: {
    node: INode;
    style: React.CSSProperties;
    [propKey: string]: any;
  }) => React.ReactElement;
}

export type DirectionKey = 'x' | 'y';

const createNodePositionData = ({ x, y, w, h, ...others }): NodePositionData => ({
  ...others,
  x,
  y,
  w,
  h,
  l: x,
  r: x + w,
  t: y,
  b: y + h,
  lr: x + w / 2,
  tb: y + h / 2,
});

export interface NodePosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NodePositionData {
  i?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  l: number;
  r: number;
  t: number;
  b: number;
  lr: number;
  tb: number;
}

interface GuideLinePositionData {
  i: number;
  $: HTMLElement;
  value: number; // 该方向的位移
  length: number; // 长度
  origin: number; // 距离该方向坐标轴距离
}

export type Direction = 'l' | 'r' | 't' | 'b';

export const DefaultDirections = {
  x: ['l', 'r', 'lr'],
  y: ['t', 'b', 'tb'],
}

export interface IContainer {
  nodes: INode[];
  onChange?: (nodes: INode[]) => any;
  onNodeMove?: (id: string, position: NodePosition, nodeIndex: number) => any;
  containerStyle?: React.CSSProperties;
  containerClassName?: string;
  nodeStyle?: React.CSSProperties;
  nodeClassName?: string;
  resizableProps?: ResizableProps;
  onNodeFocus?: (nodeId: string) => any;
  onNodeBlur?: (nodeId: string) => any;
  blurParent?: string;
}

export function unique(array, compare = (a, b) => a === b) {
  const result = []
  for (let i = 0, len = array.length; i < len; i++) {
    const current = array[i]
    if (result.findIndex(v => compare(v, current)) === -1) {
      result.push(current)
    }
  }
  return result
}

export function Container({
  nodes = [],
  onChange = noop,
  onNodeMove = noop,
  containerStyle,
  containerClassName,
  nodeStyle,
  nodeClassName,
  resizableProps,
  onNodeFocus,
  onNodeBlur,
  blurParent,
}: IContainer) {
  const handleOutsideClickCbRef = useRef(null);
  const $container = useRef(null);
  const $children = useRef(null);
  const [resizeSnap, setResizeSnap] = useState<any>({});
  const [activeNode, setActiveNode] = useState<{ id: string; $: HTMLElement }>({
    id: '',
    $: null,
  });
  const [guideLines, setGuideLines] = useState<{
    indices: number[];
    vLines: GuideLinePositionData[];
    hLines: GuideLinePositionData[];
  }>({
    indices: [],
    vLines: [],
    hLines: [],
  });
  const containerPosition = useMemo(() => {
    if ($container.current) {
      return createNodePositionData({
        x: 0, y: 0, w: $container.current.clientWidth, h: $container.current.clientHeight,
      });
    }
    return null;
  }, [$container.current]);

  handleOutsideClickCbRef.current = (e) => {
    if (activeNode.$ && !activeNode.$.contains(e.target as any)) {
      if (blurParent && !document.querySelector(blurParent).contains(e.target)) {
        return;
      }

      onNodeBlur(activeNode.id)
      setActiveNode({ id: '', $: null });
    }
  };

  const calcAndDrawLines = (
    currentNodePosData: NodePositionData,
    compareNodePosDataList: NodePositionData[],
    directions = DefaultDirections,
  ) => {
    const { v: x, indices: indices_x, lines: vLines } = calcPosValues(currentNodePosData, compareNodePosDataList, 'x', directions.x)
    const { v: y, indices: indices_y, lines: hLines } = calcPosValues(currentNodePosData, compareNodePosDataList, 'y', directions.y)

    const indices = unique(indices_x.concat(indices_y))

    // TODO: x/y轴同时出辅助线且被吸附时，持续微拖会看到辅助线挪动
    // https://github.com/zcued/react-dragline/issues/9
    if (vLines.length && hLines.length) {
      vLines.forEach(line => {
        const compare = compareNodePosDataList.find(({ i }) => i === line.i)
        const { length, origin } = calcLineValues(currentNodePosData, compare, 'x')

        line.length = length
        line.origin = origin
      })


      hLines.forEach(line => {
        const compare = compareNodePosDataList.find(({ i }) => i === line.i)
        const { length, origin } = calcLineValues(currentNodePosData, compare, 'y')

        line.length = length
        line.origin = origin
      })
    }

    setGuideLines({
      vLines,
      hLines,
      indices,
    });

    return { x, y }
  }

  const onDrag = (index, { x, y }) => {
    const newNodes = [...nodes];

    const targetPositionData = $children.current[index];

    let nextPosition: NodePosition = {
      w: targetPositionData.w,
      h: targetPositionData.h,
      x,
      y,
    };

    nextPosition = checkDragOut(nextPosition, $container.current);

    const compareNodePosDataList = $children.current.filter((_, i) => i !== index);

    // if (compareNodePosDataList.length) {
    const currentNodePosData = createNodePositionData(nextPosition);

    const snapPosition = calcAndDrawLines(currentNodePosData, [
      ...compareNodePosDataList,
      containerPosition,
    ]);

    nextPosition.x = snapPosition.x;
    nextPosition.y = snapPosition.y;
    // }

    onNodeMove(newNodes[index].id, nextPosition, index);

    newNodes[index].position = nextPosition;

    onChange(newNodes);
  };

  // 拖拽初始时 计算出所有元素的坐标信息，存储于this.$children
  const onStart = () => {
    $children.current = nodes.map((node, i) => {
      const { x, y, w, h } = node.position;

      return createNodePositionData({ x, y, w, h, i });
    });
  };

  const onStop = () => {
    setGuideLines({ vLines: [], hLines: [], indices: [] });
  }

  const getDirections = (directionList) => {
    const directions = {
      x: [],
      y: [],
    };

    directionList.forEach((direction) => {
      switch (direction) {
        case 't':
        case 'b':
          directions.y.push(direction);
          break;
        case 'l':
        case 'r':
          directions.x.push(direction);
          break;
      }
    });

    return directions;
  };

  const onResizeStart = (index, directionList) => {
    onStart();

    const currentNodePosData = $children.current[index];
    const compareNodePosDataList = $children.current.filter((_, i) => i !== index);

    if (compareNodePosDataList.length) {
      const snap: any = {};
      const directions = getDirections(directionList);

      // snap 是指的需要吸附的宽高，这里需要把吸附点与当前点的相对位置换算成对应位置时的宽高
      snap.x = getGuideLines(currentNodePosData, compareNodePosDataList, 'x', directions.x)
        .map(result => {
          return currentNodePosData.w - (result.value - currentNodePosData.x);
        });
      snap.y = getGuideLines(currentNodePosData, compareNodePosDataList, 'y', directions.y)
        .map(result => {
          return currentNodePosData.h - (result.value - currentNodePosData.y);
        });

      if (snap.x.length || snap.y.length) {
        setResizeSnap(snap);
      }
    }
  };

  const onResizeStop = (index, direction, delta) => {
    setResizeSnap({});
    setGuideLines({ vLines: [], hLines: [], indices: [] });
  };

  const onResize = (index, directionList, { w, h, x, y }) => {
    const newNodes = [...nodes];
    const nextPosition = {
      x, y, w, h
    };

    const compareNodePosDataList = $children.current.filter((_, i) => i !== index);

    if (compareNodePosDataList.length) {
      const currentNodePosData = createNodePositionData(nextPosition);

      const directions = getDirections(directionList);

      // 只用展示辅助线，不用处理吸附，吸附在起拖时就计算好了
      calcAndDrawLines(currentNodePosData, compareNodePosDataList, directions);
    }

    onNodeMove(newNodes[index].id, nextPosition, index);

    newNodes[index] = {
      ...newNodes[index],
      position: nextPosition,
    };

    onChange(newNodes);
  };

  const renderNodes = () => {
    return nodes.map((node, index) => (
      <Node
        key={node.id || index}
        node={node}
        onDrag={(e, { x, y }) => onDrag(index, { x, y })}
        onDragStart={onStart}
        onDragStop={onStop}
        onResize={(e, direction, delta) => onResize(index, direction, delta)}
        onResizeStart={(e, direction) => onResizeStart(index, direction)}
        onResizeStop={(e, direction, delta) => onResizeStop(index, direction, delta)}
        snap={resizeSnap}
        active={activeNode.id === node.id}
        className={nodeClassName}
        style={nodeStyle}
        resizableProps={resizableProps}
        onClick={(e, node, element) => {
          onNodeFocus(node.id);
          setActiveNode({
            id: node.id,
            $: element,
          });
        }}
      />
    ));
  }

  const renderGuidelines = () => {
    const { vLines, hLines } = guideLines;

    return (
      <>
        {vLines.map(({ length, value, origin }, i) => (
          <span
            className="v-line"
            key={`v-${i}`}
            style={{
              position: 'absolute',
              backgroundColor: '#FF00CC',
              left: 0,
              top: 0,
              transform: `translate(${value}px, ${origin}px)`,
              height: length,
              width: 1,
            }}
          />
        ))}
        {hLines.map(({ length, value, origin }, i) => (
          <span
            className="h-line"
            key={`h-${i}`}
            style={{
              width: length,
              height: 1,
              left: 0,
              top: 0,
              transform: `translate(${origin}px, ${value}px)`,
              position: 'absolute',
              backgroundColor: '#FF00CC',
            }}
          />
        ))}
      </>
    )
  };

  useEffect(() => {
    document.addEventListener('click', (e) => {
      handleOutsideClickCbRef.current(e);
    });
  }, []);

  return (
    <div
      className={classNames('react-rnd-dragline-container', containerClassName)}
      style={containerStyle}
      ref={$container}
    >
      {renderNodes()}
      {renderGuidelines()}
    </div>
  )
}
